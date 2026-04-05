import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  onAuthStateChanged,
  signOut,
  signInAnonymously,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  addDoc 
} from 'firebase/firestore';

// --- PRODUCTION FIREBASE CONFIG ---
const productionConfig = {
  apiKey: "AIzaSyBcAAg1m5IWwVXsYMVreOJHGGZCxyOSas0",
  authDomain: "roddfitnessnj.firebaseapp.com",
  projectId: "roddfitnessnj",
  storageBucket: "roddfitnessnj.firebasestorage.app",
  messagingSenderId: "353497562828",
  appId: "1:353497562828:web:d8ff9ad7e3b5202c068c69",
  measurementId: "G-5KBE89CP3C"
};

// Auto-detect environment to allow local previewing and Netlify deployment
const isCanvas = typeof __firebase_config !== 'undefined';
const firebaseConfig = isCanvas ? JSON.parse(__firebase_config) : productionConfig;
// Sanitize the appId to ensure it doesn't contain slashes which break Firebase collection paths
const activeAppId = (isCanvas && typeof __app_id !== 'undefined' ? __app_id : 'roddfitnessnj').replace(/[\/\.]/g, '-');

// --- INIT ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// --- CONSTANTS ---
const ACTIVITIES = [
  { id: 'pedal', name: 'Pedaled', icon: '🚲' },
  { id: 'balance', name: 'Balanced', icon: '🦩' },
  { id: 'walk', name: 'Walked', icon: '🚶' },
  { id: 'stretch', name: 'Stretched', icon: '🧘' },
];

const VIBES = [
  { id: 'crap', emoji: '🤮', label: 'Like Crap' },
  { id: 'meh', emoji: '🫠', label: 'Just Meh' },
  { id: 'good', emoji: '😎', label: 'Feeling Good' },
  { id: 'crushed', emoji: '🔥', label: 'Crushed It' },
];

// --- HELPERS ---
const getLocalDayString = (timestamp) => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const calculateStreak = (userId, allLogs) => {
  const userLogs = allLogs.filter(l => l.userId === userId).sort((a, b) => b.timestamp - a.timestamp);
  if (userLogs.length === 0) return 0;

  const uniqueDays = [...new Set(userLogs.map(l => getLocalDayString(l.timestamp)))];
  
  const todayStr = getLocalDayString(Date.now());
  const yesterdayStr = getLocalDayString(Date.now() - 86400000);

  if (uniqueDays[0] !== todayStr && uniqueDays[0] !== yesterdayStr) {
    return 0; // Streak broken
  }

  let streak = 0;
  let currentDate = new Date(uniqueDays[0] + 'T12:00:00'); 

  for (let i = 0; i < uniqueDays.length; i++) {
    const logDateStr = uniqueDays[i];
    const expectedDateStr = getLocalDayString(currentDate.getTime());
    
    if (logDateStr === expectedDateStr) {
      streak++;
      currentDate.setDate(currentDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  
  const [logs, setLogs] = useState([]);
  const [view, setView] = useState('log'); // 'log' or 'feed'
  
  // Form State
  const [activity, setActivity] = useState(null);
  const [minutes, setMinutes] = useState(5);
  const [vibe, setVibe] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // 1. Auth Listener
  useEffect(() => {
    // If previewing in Canvas, handle anonymous auth rule. If production, wait for user.
    if (isCanvas) {
       const initCanvasAuth = async () => {
         try {
           if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
             await signInWithCustomToken(auth, __initial_auth_token);
           } else {
             await signInAnonymously(auth);
           }
         } catch (e) { console.error(e); }
       };
       initCanvasAuth();
    }

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Data Fetching
  useEffect(() => {
    if (!user) return;

    // We use a strictly pathed collection structure for security and compatibility
    const logsRef = collection(db, 'artifacts', activeAppId, 'public', 'data', 'logs');
    const unsubscribe = onSnapshot(logsRef, (snapshot) => {
      const fetchedLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      fetchedLogs.sort((a, b) => b.timestamp - a.timestamp);
      setLogs(fetchedLogs);
    }, (error) => {
      console.error("Firestore Error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError('Sign in failed. Ensure popups are allowed or try again.');
      console.error(err);
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setLogs([]);
  };

  const currentStreak = useMemo(() => {
    if (!user) return 0;
    return calculateStreak(user.uid, logs);
  }, [user, logs]);

  const topStreaks = useMemo(() => {
    const userGroups = {};
    logs.forEach(log => {
      if (!userGroups[log.userId]) {
        userGroups[log.userId] = { 
          name: log.userName || 'Anonymous User', 
          id: log.userId,
          photo: log.userPhoto 
        };
      }
    });
    
    return Object.values(userGroups)
      .map(u => ({ ...u, streak: calculateStreak(u.id, logs) }))
      .filter(u => u.streak > 0)
      .sort((a, b) => b.streak - a.streak)
      .slice(0, 5); 
  }, [logs]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!activity || !vibe || !user) return;

    setIsSubmitting(true);
    
    try {
      await addDoc(collection(db, 'artifacts', activeAppId, 'public', 'data', 'logs'), {
        userId: user.uid,
        userName: user.displayName || 'Anonymous User',
        userPhoto: user.photoURL || null,
        activity,
        minutes: Number(minutes),
        vibe,
        timestamp: Date.now()
      });
      setShowSuccess(true);
    } catch (err) {
      console.error("Error logging activity", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setShowSuccess(false);
    setActivity(null);
    setVibe(null);
    setMinutes(5);
  };

  // --- LOGIN SCREEN ---
  if (authLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-white text-xl animate-pulse font-bold tracking-widest">LOADING...</div>
      </div>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-6 selection:bg-indigo-500/30">
        <div className="max-w-md w-full text-center space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="space-y-4">
            <h1 className="text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 to-emerald-400">
              LightFit.
            </h1>
            <p className="text-xl text-neutral-400 font-medium">Keep it light. Keep it moving.</p>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl">
            <p className="text-neutral-300 mb-8 leading-relaxed">
              Log your daily movement, track your streaks, and check the vibe. No heavy lifting required.
            </p>
            
            <button 
              onClick={handleLogin}
              className="w-full bg-white text-black py-4 rounded-xl font-bold text-lg hover:bg-neutral-200 transition-colors flex items-center justify-center gap-3 active:scale-[0.98]"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
            {authError && <p className="text-red-400 text-sm mt-4 font-bold">{authError}</p>}
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN APP ---
  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-indigo-500/30">
      
      {/* Top Navigation */}
      <div className="sticky top-0 z-50 bg-neutral-950/90 backdrop-blur-lg border-b border-neutral-800">
        <div className="max-w-md mx-auto flex justify-between items-center p-4">
          <div className="flex gap-5">
            <button 
              onClick={() => { setView('log'); resetForm(); }}
              className={`font-black tracking-tight text-lg transition-colors ${view === 'log' ? 'text-white drop-shadow-md' : 'text-neutral-600 hover:text-neutral-400'}`}
            >
              Log
            </button>
            <button 
              onClick={() => setView('feed')}
              className={`font-black tracking-tight text-lg transition-colors ${view === 'feed' ? 'text-white drop-shadow-md' : 'text-neutral-600 hover:text-neutral-400'}`}
            >
              The Vibe
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-orange-500 bg-orange-500/10 px-2 py-1 rounded-lg border border-orange-500/20">
              <span className="text-sm drop-shadow-[0_0_8px_rgba(249,115,22,0.8)]">🔥</span>
              <span className="font-black">{currentStreak}</span>
            </div>
            <div className="relative group cursor-pointer">
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" className="w-9 h-9 rounded-full border border-neutral-700" onClick={handleLogout}/>
              ) : (
                <div className="w-9 h-9 bg-neutral-800 rounded-full flex items-center justify-center border border-neutral-700" onClick={handleLogout}>
                  {user.displayName?.charAt(0) || 'U'}
                </div>
              )}
              {/* Tooltip hint for logout */}
              <div className="absolute right-0 top-12 bg-neutral-800 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                Click to logout
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 md:p-6 pb-24">
        
        {view === 'log' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {showSuccess ? (
              <div className="text-center space-y-6 pt-12">
                <div className="text-8xl mb-4 animate-bounce">🎉</div>
                <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-600">
                  BOOM!
                </h1>
                <p className="text-xl text-neutral-300">
                  Logged {minutes} mins of {ACTIVITIES.find(a => a.id === activity)?.name.toLowerCase()}.
                </p>
                
                <div className="bg-neutral-900 rounded-3xl p-6 mt-8 border border-neutral-800 shadow-2xl">
                  <p className="text-sm text-neutral-400 uppercase tracking-widest font-bold mb-2">Current Streak</p>
                  <div className="flex items-center justify-center gap-3 text-orange-500">
                    <span className="text-5xl drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]">🔥</span>
                    <span className="text-6xl font-black">{currentStreak}</span>
                    <span className="text-xl text-neutral-400 self-end mb-2">Days</span>
                  </div>
                </div>

                <div className="pt-8 space-y-4">
                  <img 
                    src="https://media.giphy.com/media/l0HU7yHIK6Nc3WcE0/giphy.gif" 
                    alt="Cheering" 
                    className="rounded-2xl w-full object-cover h-48 border border-neutral-800 shadow-xl"
                  />
                  <button 
                    onClick={() => setView('feed')}
                    className="w-full py-4 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-bold transition-colors active:scale-[0.98]"
                  >
                    See The Vibe
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-neutral-900 rounded-3xl shadow-2xl overflow-hidden border border-neutral-800 mt-4">
                <div className="p-6 pb-2">
                  <h1 className="text-2xl font-black tracking-tight">Log It</h1>
                  <p className="text-neutral-400 text-sm mt-1">Keep it light. Keep it moving.</p>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-8">
                  {/* Activity */}
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">What did you do?</label>
                    <div className="grid grid-cols-2 gap-3">
                      {ACTIVITIES.map((act) => (
                        <button
                          key={act.id}
                          type="button"
                          onClick={() => setActivity(act.id)}
                          className={`p-4 rounded-2xl flex flex-col items-center gap-2 transition-all duration-200 border-2 ${
                            activity === act.id 
                              ? 'bg-indigo-500/20 border-indigo-500 text-white scale-[0.98] shadow-inner' 
                              : 'bg-neutral-950 border-transparent text-neutral-400 hover:bg-neutral-800'
                          }`}
                        >
                          <span className="text-3xl drop-shadow-md">{act.icon}</span>
                          <span className="font-bold text-sm">{act.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Time */}
                  <div className="space-y-4 pt-4 border-t border-neutral-800">
                    <div className="flex justify-between items-end">
                      <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">For how long?</label>
                      <div className="text-4xl font-black text-indigo-400 tracking-tighter">{minutes} <span className="text-lg text-neutral-500 font-bold">min</span></div>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="60"
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                      className="w-full h-4 bg-neutral-950 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>

                  {/* Vibe */}
                  <div className="space-y-3 pt-4 border-t border-neutral-800">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">How do you feel?</label>
                    <div className="flex justify-between gap-2">
                      {VIBES.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setVibe(v.id)}
                          className={`flex-1 py-3 rounded-2xl flex flex-col items-center gap-1 transition-all duration-200 border-2 ${
                            vibe === v.id 
                              ? 'bg-emerald-500/20 border-emerald-500 scale-[1.05] shadow-lg shadow-emerald-500/20 z-10' 
                              : 'bg-neutral-950 border-transparent opacity-50 hover:opacity-100 hover:bg-neutral-800'
                          }`}
                        >
                          <span className="text-2xl drop-shadow-md">{v.emoji}</span>
                          <span className={`text-[10px] font-bold tracking-tight ${vibe === v.id ? 'text-emerald-400' : 'text-neutral-400'}`}>
                            {v.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Submit */}
                  <div className="pt-4">
                    <button
                      type="submit"
                      disabled={!activity || !vibe || isSubmitting}
                      className={`w-full py-5 rounded-2xl font-black text-xl tracking-wide transition-all duration-200 ${
                        !activity || !vibe 
                          ? 'bg-neutral-900 text-neutral-700 cursor-not-allowed border border-neutral-800'
                          : 'bg-indigo-600 text-white hover:bg-indigo-500 active:scale-[0.98] shadow-lg shadow-indigo-600/30'
                      }`}
                    >
                      {isSubmitting ? 'LOGGING...' : 'LOG IT 👊'}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {view === 'feed' && (
          <div className="animate-in fade-in duration-500 space-y-8 mt-4">
            
            {/* Top Streaks */}
            {topStreaks.length > 0 && (
              <div className="bg-neutral-900 rounded-3xl p-5 border border-neutral-800 shadow-xl">
                <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  <span>🏆</span> Top Streaks
                </h2>
                <div className="flex flex-wrap gap-2">
                  {topStreaks.map((u, i) => (
                    <div key={u.id} className="bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 flex items-center gap-2">
                      {u.photo ? (
                        <img src={u.photo} alt="img" className="w-5 h-5 rounded-full" />
                      ) : (
                        <div className="w-5 h-5 bg-neutral-800 rounded-full flex items-center justify-center text-[10px]">
                          {(u.name || 'U').charAt(0)}
                        </div>
                      )}
                      <span className="text-xs font-bold text-neutral-300">
                        {u.id === user?.uid ? 'You' : (u.name || 'User').split(' ')[0]}
                      </span>
                      <span className="text-orange-500 font-black text-sm">{u.streak}🔥</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Global Feed */}
            <div>
              <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4">Latest Activity</h2>
              {logs.length === 0 ? (
                <div className="text-center p-8 bg-neutral-900 rounded-3xl border border-neutral-800">
                  <p className="text-neutral-500 font-medium">It's quiet. Be the first to move.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.slice(0, 30).map(log => {
                    const actData = ACTIVITIES.find(a => a.id === log.activity);
                    const vibeData = VIBES.find(v => v.id === log.vibe);
                    const isMe = log.userId === user?.uid;
                    
                    if (!actData || !vibeData) return null;

                    return (
                      <div key={log.id} className={`p-4 rounded-2xl border flex items-center gap-4 transition-all ${isMe ? 'bg-indigo-950/30 border-indigo-900/50' : 'bg-neutral-900 border-neutral-800'}`}>
                        <div className="text-3xl bg-neutral-950 h-14 w-14 rounded-xl flex items-center justify-center shadow-inner border border-neutral-800 shrink-0">
                          {actData.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">
                            <span className={`font-bold ${isMe ? 'text-indigo-400' : 'text-white'}`}>
                              {isMe ? 'You' : log.userName}
                            </span> 
                            <span className="text-neutral-400"> {actData.name.toLowerCase()} for </span> 
                            <span className="font-bold text-white">{log.minutes} min</span>
                          </p>
                          <p className="text-xs text-neutral-500 mt-1 flex items-center gap-1">
                            {vibeData.emoji} {vibeData.label} • {new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}