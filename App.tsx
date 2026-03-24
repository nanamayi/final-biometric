import React, { useState, useEffect } from 'react';
import { User, HistoryItem, Tab } from './types';
import RegisterSection from './components/RegisterSection';
import KeylockerSection from './components/KeylockerSection';
import RegisteredUsersSection from './components/RegisteredUsersSection';
import HistorySection from './components/HistorySection';
import BottomNav from './components/BottomNav';
import { Key, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { supabase, SUPABASE_CONFIGURED } from './supabase';

// ✅ Added: Web Crypto hash for backup PIN
async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('Register');
  const [users, setUsers] = useState<User[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const fetchUsers = async () => {
    if (!SUPABASE_CONFIGURED) return;

    const { data, error } = await supabase
      .from('registered_users')
      .select('*')
      .order('registered_at', { ascending: false });

    if (error) {
      console.error('Error fetching users:', error);
      return;
    }

    const transformedUsers: User[] = (data || []).map((u: any) => ({
      id: u.id,
      fullName: u.full_name,
      program: u.program,
      position: u.position,
      yearSection: '' as any,
      photoUrl: u.photo_url,
      fingerprintId: String(u.fingerprint_id ?? '').trim(),
      registeredAt: new Date(u.registered_at).getTime()
    }));

    setUsers(transformedUsers);
  };

  const fetchHistory = async () => {
    if (!SUPABASE_CONFIGURED) return;

    const { data, error } = await supabase
      .from('history_view')
      .select('*')
      .order('time_in', { ascending: false });

    if (error) {
      console.error('Error fetching history:', error);
      return;
    }

    const transformedHistory: HistoryItem[] = (data || []).map((h: any) => ({
      id: h.id,
      userId: h.user_id,
      userName: h.user_name,
      userPhoto: h.user_photo,
      program: h.program,
      position: h.position,
      yearSection: h.year_section,
      keyNumber: h.key_number,
      date: new Date(h.log_date).toLocaleDateString(),
      timeIn: new Date(h.time_in).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      }),
      timeOut: h.time_out
        ? new Date(h.time_out).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          })
        : null,
      status: h.status
    }));

    setHistory(transformedHistory);
  };

  useEffect(() => {
    const splashTimer = setTimeout(() => setShowSplash(false), 2500);

    if (SUPABASE_CONFIGURED) {
      setIsLoading(true);
      Promise.all([fetchUsers(), fetchHistory()]).finally(() => setIsLoading(false));
    }

    return () => clearTimeout(splashTimer);
  }, []);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;

    if (activeTab === 'Registered') fetchUsers();
    if (activeTab === 'History') fetchHistory();
    if (activeTab === 'Keylocker') {
      fetchUsers();
      fetchHistory();
    }
  }, [activeTab]);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;

    const usersChannel = supabase
      .channel('realtime-registered-users')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'registered_users' },
        async () => {
          await fetchUsers();
        }
      )
      .subscribe();

    const logsChannel = supabase
      .channel('realtime-key-logs')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'key_logs' },
        async () => {
          await fetchHistory();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(usersChannel);
      supabase.removeChannel(logsChannel);
    };
  }, []);

  const waitForCommandResult = async (commandId: string, timeoutMs = 30000) => {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const { data, error } = await supabase
        .from('device_commands')
        .select('processed,result,scanned_fingerprint_id')
        .eq('id', commandId)
        .single();

      if (error) {
        throw new Error(error.message);
      }

      if (data?.processed) {
        return data;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    throw new Error('Command timeout.');
  };

  // ✅ Updated: direct register with hashed PIN, no Edge Function
  const handleRegister = async (newUser: User & { backupPin?: string }) => {
    if (!SUPABASE_CONFIGURED) {
      alert('Supabase is not configured.');
      return;
    }

    setIsLoading(true);

    try {
      if (!newUser.backupPin) {
        throw new Error('Backup PIN is required.');
      }

      const pinHash = await hashPin(newUser.backupPin);

      const { error } = await supabase
        .from('registered_users')
        .insert({
          full_name: newUser.fullName,
          program: newUser.program,
          position: newUser.position,
          photo_url: newUser.photoUrl,
          fingerprint_id: Number(newUser.fingerprintId),
          pin_hash: pinHash
        });

      if (error) throw error;

      await fetchUsers();
      setActiveTab('Keylocker');
      alert('User registered successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to register user.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBorrow = async (item: HistoryItem) => {
    if (!SUPABASE_CONFIGURED) return;

    setIsLoading(true);

    try {
      const user = users.find((u) => u.id === item.userId);

      const { data, error: cmdError } = await supabase
        .from('device_commands')
        .insert({
          device_id: 'locker_1',
          action: 'verify_and_unlock',
          expected_fingerprint_id: Number(user?.fingerprintId),
          key_number: item.keyNumber,
          processed: false,
          result: 'pending'
        })
        .select('id')
        .single();

      if (cmdError) throw cmdError;

      const result = await waitForCommandResult(data.id, 30000);

      if (result.result !== 'matched') {
        throw new Error('Fingerprint verification failed.');
      }

      const { error } = await supabase.from('key_logs').insert({
        user_id: item.userId,
        year_section: item.yearSection,
        key_number: item.keyNumber,
        status: 'Borrowed',
        time_in: new Date().toISOString()
      });

      if (error) throw error;

      await fetchHistory();
    } catch (err: any) {
      alert(err.message || 'Failed to borrow key.');
    }

    setIsLoading(false);
  };

  const handleReturn = async (logId: string) => {
    if (!SUPABASE_CONFIGURED) return;

    setIsLoading(true);

    try {
      const log = history.find((h) => h.id === logId);
      const user = users.find((u) => u.id === log?.userId);

      const { data, error: cmdError } = await supabase
        .from('device_commands')
        .insert({
          device_id: 'locker_1',
          action: 'verify_and_unlock',
          expected_fingerprint_id: Number(user?.fingerprintId),
          key_number: log?.keyNumber,
          processed: false,
          result: 'pending'
        })
        .select('id')
        .single();

      if (cmdError) throw cmdError;

      const result = await waitForCommandResult(data.id, 30000);

      if (result.result !== 'matched') {
        throw new Error('Verification failed.');
      }

      const { error: updateError } = await supabase
        .from('key_logs')
        .update({
          status: 'Returned',
          time_out: new Date().toISOString()
        })
        .eq('id', logId);

      if (updateError) throw updateError;

      await fetchHistory();
    } catch (err: any) {
      alert(err.message || 'Failed to return key.');
    }

    setIsLoading(false);
  };

  const renderContent = () => {
    if (!SUPABASE_CONFIGURED) {
      return (
        <div className="bg-white rounded-[2.5rem] p-10 shadow-xl border-2 border-dashed border-amber-200 text-center space-y-6 animate-in zoom-in-95 duration-500">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center text-amber-600 mx-auto">
            <AlertTriangle size={32} />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-black text-gray-900">Backend Setup Required</h2>
            <p className="text-gray-500 font-medium text-sm">
              To enable cloud storage, connect your Supabase project.
            </p>
          </div>

          <div className="bg-gray-50 p-6 rounded-3xl text-left space-y-4">
            <p className="text-sm font-bold text-gray-700 uppercase tracking-wider">
              Instructions:
            </p>
            <div className="bg-white p-4 rounded-xl border border-gray-200 font-mono text-[11px] break-all shadow-inner text-indigo-700">
              SUPABASE_URL=your_project_url
              <br />
              SUPABASE_ANON_KEY=your_anon_key
            </div>
          </div>

          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-indigo-600 text-white font-black rounded-2xl hover:bg-indigo-700 transition-all text-sm uppercase shadow-lg"
          >
            Supabase Dashboard <ExternalLink size={16} />
          </a>
        </div>
      );
    }

    if (isLoading && !showSplash) {
      return (
        <div className="flex flex-col items-center justify-center py-20 animate-pulse">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
          <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">
            Processing Request...
          </p>
        </div>
      );
    }

    switch (activeTab) {
      case 'Register':
        return (
          <RegisterSection
            onRegister={handleRegister}
            users={users}
          />
        );

      case 'Keylocker':
        return (
          <KeylockerSection
            users={users}
            history={history}
            onBorrow={handleBorrow}
            onReturn={handleReturn}
          />
        );

      case 'Registered':
        return <RegisteredUsersSection users={users} />;

      case 'History':
        return <HistorySection history={history} />;

      default:
        return (
          <RegisterSection
            onRegister={handleRegister}
            users={users}
          />
        );
    }
  };

  return (
    <div
      className={`flex flex-col min-h-screen pb-20 transition-colors duration-500 ${
        activeTab === 'History' ? 'bg-[#3b5998]' : 'bg-indigo-50'
      }`}
    >
      {showSplash && (
        <div className="fixed inset-0 z-[100] bg-indigo-900 flex flex-col items-center justify-center splash-overlay text-white">
          <div className="p-4 bg-white/10 rounded-3xl mb-6 animate-title-opening">
            <Key size={64} className="text-white" />
          </div>

          <h1 className="text-3xl font-black uppercase tracking-widest animate-letter-reveal">
            Biometric Key Locker
          </h1>

          <div className="mt-8 w-48 h-1 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white w-1/2 animate-[progress_2.5s_ease-in-out_infinite]" />
          </div>
        </div>
      )}

      <header
        className={`p-4 sticky top-0 z-50 flex items-center justify-between transition-colors duration-500 ${
          activeTab === 'History' ? 'bg-[#3b5998] text-white shadow-none' : 'bg-white shadow-sm'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`${
              activeTab === 'History' ? 'bg-white/20' : 'bg-indigo-600'
            } p-2 rounded-lg text-white shadow-sm`}
          >
            <Key size={22} />
          </div>

          <h1
            className={`font-black text-xl tracking-tight ${
              activeTab === 'History' ? 'text-white' : 'text-indigo-900'
            }`}
          >
            Biometric Key Locker
          </h1>
        </div>

        <div>
          <div
            className={`text-xs font-black px-3 py-1.5 rounded-full ${
              activeTab === 'History'
                ? 'bg-white/10 text-white'
                : 'bg-indigo-50 text-indigo-700'
            }`}
          >
            {new Date().toLocaleDateString()}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6">
        {renderContent()}
      </main>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default App;