import React, { useMemo } from 'react';
import { HistoryItem } from '../types';
import { EyeOff } from 'lucide-react';

interface HistorySectionProps {
  history: HistoryItem[];
}

const HistorySection: React.FC<HistorySectionProps> = ({ history }) => {
  // Group history items by date
  const groupedHistory = useMemo(() => {
    return history.reduce((groups: { [key: string]: HistoryItem[] }, item) => {
      const date = item.date;
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(item);
      return groups;
    }, {});
  }, [history]);

  const dates = useMemo(() => 
    Object.keys(groupedHistory).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()), 
    [groupedHistory]
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10 px-1">
      {/* Compact Header */}
      <div className="flex items-center justify-between px-1 pt-1">
        <h2 className="text-2xl font-bold text-gray-800 tracking-tight">History</h2>
        <button className="w-8 h-8 bg-rose-50 rounded-full flex items-center justify-center text-rose-300 shadow-sm border border-rose-100">
          <EyeOff size={16} />
        </button>
      </div>

      <div className="space-y-8">
        {dates.length > 0 ? (
          dates.map((date) => (
            <div key={date} className="space-y-3">
              {/* Centered Date Header */}
              <h3 className="text-center text-xl font-black text-[#1a2a4b] opacity-80 tracking-tight">
                {date}
              </h3>
              
              <div className="bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100">
                <div className="overflow-x-auto no-scrollbar">
                  <table className="w-full text-center border-collapse table-auto min-w-[500px]">
                    <thead>
                      <tr className="bg-gray-50/50 border-b border-gray-100">
                        <th className="px-3 py-4 text-[11px] font-bold text-gray-700 uppercase tracking-tight">User</th>
                        <th className="px-2 py-4 text-[11px] font-bold text-gray-700 uppercase tracking-tight">Yr&Section</th>
                        <th className="px-2 py-4 text-[11px] font-bold text-gray-700 uppercase tracking-tight">Time In</th>
                        <th className="px-2 py-4 text-[11px] font-bold text-gray-700 uppercase tracking-tight">Time Out</th>
                        <th className="px-2 py-4 text-[11px] font-bold text-gray-700 uppercase tracking-tight">Key No.</th>
                        <th className="px-3 py-4 text-[11px] font-bold text-gray-700 uppercase tracking-tight">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {groupedHistory[date].map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50/30 transition-colors">
                          <td className="px-3 py-3">
                            <div className="flex flex-col items-center gap-1">
                              <img 
                                src={item.userPhoto} 
                                alt="" 
                                className="w-10 h-10 rounded-full object-cover border-2 border-white shadow-sm"
                              />
                              <span className="text-[10px] font-bold text-gray-800 leading-tight">
                                {item.userName}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-3">
                            <span className="text-[11px] font-medium text-gray-600">
                              {item.yearSection}
                            </span>
                          </td>
                          <td className="px-2 py-3">
                            <span className="text-[10px] font-medium text-gray-600 whitespace-nowrap">
                              {item.timeIn}
                            </span>
                          </td>
                          <td className="px-2 py-3">
                            <span className="text-[10px] font-medium text-gray-600 whitespace-nowrap">
                              {item.timeOut || '--:--:--'}
                            </span>
                          </td>
                          <td className="px-2 py-3">
                            <span className="text-[11px] font-bold text-indigo-600">
                              #{item.keyNumber.replace('Key-', '')}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
                              item.status === 'Returned' 
                                ? 'text-rose-600 bg-rose-50 border border-rose-100' 
                                : 'text-amber-600 bg-amber-50 border border-amber-100'
                            }`}>
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-20 opacity-20">
            <EyeOff size={40} className="text-gray-400 mb-2" />
            <h3 className="text-gray-800 text-lg font-black uppercase tracking-widest">Empty History</h3>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistorySection;