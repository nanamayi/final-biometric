
import React from 'react';
import { User } from '../types';
import { Calendar, IdCard } from 'lucide-react';

interface RegisteredUsersSectionProps {
  users: User[];
}

const RegisteredUsersSection: React.FC<RegisteredUsersSectionProps> = ({ users }) => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-3">
        <div>
          <h2 className="text-2xl font-black text-gray-900">Registered Users</h2>
          <p className="text-gray-600 font-medium text-sm">Total users: <span className="text-indigo-700 font-black">{users.length}</span> members</p>
        </div>
        <div className="p-3.5 bg-indigo-700 rounded-2xl shadow-lg text-white">
          <Calendar size={22} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {users.length > 0 ? (
          users.map(u => (
            <div key={u.id} className="bg-white rounded-[2rem] shadow-md p-6 border border-gray-200 hover:shadow-xl hover:border-indigo-100 transition-all relative overflow-hidden group">
              <div className="absolute -top-4 -right-4 p-4 opacity-[0.05] text-indigo-900 group-hover:opacity-[0.08] transition-opacity">
                <IdCard size={80} />
              </div>
              <div className="flex items-center gap-5 relative">
                <div className="relative">
                  <img src={u.photoUrl} alt="" className="w-20 h-20 rounded-[1.5rem] object-cover border-2 border-indigo-100 shadow-md" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 border-4 border-white rounded-full"></div>
                </div>
                <div className="flex-1">
                  <h3 className="font-black text-gray-900 text-lg leading-tight mb-1">{u.fullName}</h3>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-black text-indigo-700 uppercase tracking-wider bg-indigo-50 w-fit px-2.5 py-1 rounded-lg border border-indigo-100">{u.program}</span>
                    <span className="text-[11px] text-gray-700 font-bold uppercase tracking-tight">{u.position}</span>
                  </div>
                </div>
              </div>
              <div className="mt-6 pt-5 border-t border-gray-100 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-black text-gray-400 tracking-widest">Biometric ID</span>
                  <span className="text-xs font-mono font-black text-indigo-900 bg-indigo-50/50 px-2 py-0.5 rounded-md border border-indigo-50">{u.fingerprintId}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-black text-gray-400 tracking-widest block">Registered</span>
                  <span className="text-[11px] text-gray-700 font-bold">{new Date(u.registeredAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full bg-white rounded-[2.5rem] p-16 text-center text-gray-500 border-2 border-dashed border-gray-200 shadow-sm">
            <IdCard size={64} className="mx-auto mb-5 text-gray-200" />
            <p className="font-black text-xl text-gray-800">No registered users</p>
            <p className="text-gray-500 font-medium mt-1">Visit the Register tab to add new personnel.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RegisteredUsersSection;
