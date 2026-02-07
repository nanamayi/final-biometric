
import React from 'react';
import { Tab } from '../types';
import { UserPlus, Key, Users, History } from 'lucide-react';

interface BottomNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'Register' as Tab, label: 'Register', icon: UserPlus },
    { id: 'Keylocker' as Tab, label: 'Keylocker', icon: Key },
    { id: 'Registered' as Tab, label: 'Registered', icon: Users },
    { id: 'History' as Tab, label: 'History', icon: History },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-2 flex justify-around items-center z-50">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          className={`flex flex-col items-center gap-1 transition-colors px-4 py-2 rounded-xl ${
            activeTab === id ? 'text-indigo-600 bg-indigo-50' : 'text-gray-400'
          }`}
        >
          <Icon size={20} />
          <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
        </button>
      ))}
    </nav>
  );
};

export default BottomNav;
