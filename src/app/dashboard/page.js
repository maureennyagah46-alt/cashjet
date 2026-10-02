"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/game-store';
import { useAuthStore } from '@/store/auth-store';
import { generateRandomUsername, generateRandomBetAmount } from '@/utils/usernames';
import { useAudio } from '@/utils/sounds';
import GameCanvas from '@/components/game-canvas';
import LiveChat from '@/components/live-chat';
import DepositModal from '@/components/deposit-modal';
import WithdrawModal from '@/components/withdraw-modal';
import {
  TrendingUp, Wallet, LogOut, Users, Trophy, MessageCircle,
  Plus, Minus, ChevronRight, RefreshCw, Plane, History
} from 'lucide-react';

// ─── Game Engine Hook ────────────────────────────────────────────────────────
function useGameEngine() {
  const store = useGameStore;
  const { playCrashSound, playCoinSound, playCountdownSound } = useAudio();
  const multiplierRef = useRef(1);
  const flyingIntervalRef = useRef(null);
  const waitingIntervalRef = useRef(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    function computeCrashPoint() {
      const balance = store.getState().balance;
      let rand = Math.random();
      if (balance === 0) return 13 + 17 * Math.random();
      if (balance >= 4500) return 1.2 + 0.22 * Math.random();
      if (rand < 0.70) return Math.round(100 * (4.76 + 3.15 * Math.random())) / 100;
      if (rand < 0.85) return Math.round(100 * (1.21 + 3.23 * Math.random())) / 100;
      if (rand < 0.95) return Math.round(100 * (8.11 + 5.00 * Math.random())) / 100;
      return Math.round(100 * (13.56 + 42 * Math.random())) / 100;
    }

    function startRound() {
      const cp = computeCrashPoint();
      const roundId = Date.now().toString();
      const state = store.getState();

      state.setCrashPoint(cp);
      state.setRoundId(roundId);
      state.setCurrentMultiplier(1);
      multiplierRef.current = 1;
      state.resetCashoutState();

      // Generate fake live bets (8-16 bots)
      const count = Math.floor(Math.random() * 9) + 8;
      const liveBets = Array.from({ length: count }, (_, i) => ({
        id: `fake-${Date.now()}-${i}`,
        username: generateRandomUsername(),
        stake: generateRandomBetAmount(),
        cashedOutAt: null,
        won: null,
        status: 'betting',
      }));
      state.setLiveBets(liveBets);
      state.setTopCrashers([
        { username: generateRandomUsername(), multiplier: 20.86 },
        { username: generateRandomUsername(), multiplier: 14.14 },
        { username: generateRandomUsername(), multiplier: 10.51 },
      ]);

      // COUNTDOWN phase
      state.setGamePhase('waiting');
      let countdown = 15;
      state.setCountdown(countdown);

      waitingIntervalRef.current = setInterval(() => {
        countdown--;
        store.getState().setCountdown(countdown);
        if (countdown <= 3 && countdown > 0) playCountdownSound();
        if (countdown <= 0) {
          clearInterval(waitingIntervalRef.current);
          startFlying(cp);
        }
      }, 1000);
    }

    function startFlying(cp) {
      const state = store.getState();
      state.setGamePhase('flying');
      const startTime = Date.now();

      // Auto-place bets if configured
      if (state.autoBet1 && state.balance >= state.bet1Amount) state.placeBet1();
      if (state.autoBet2 && state.balance >= state.bet2Amount) state.placeBet2();

      flyingIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const mult = parseFloat(Math.pow(1.0024, elapsed / 10).toFixed(2));
        multiplierRef.current = mult;
        const s = store.getState();
        s.setCurrentMultiplier(mult);

        // Bot cash-outs: randomly have some bots cash out during flight
        if (Math.random() < 0.03 && s.liveBets.some(b => b.status === 'betting')) {
          const bettingBots = s.liveBets.filter(b => b.status === 'betting');
          if (bettingBots.length > 0) {
            const bot = bettingBots[Math.floor(Math.random() * bettingBots.length)];
            s.updateLiveBet(bot.id, { status: 'won', cashedOutAt: mult, won: true });
          }
        }

        // Auto-cashout for player bets
        if (s.autoCashout1Enabled && s.bet1Active && !s.bet1CashedOut && mult >= s.autoCashout1) {
          s.cashoutBet1();
          playCoinSound();
        }
        if (s.autoCashout2Enabled && s.bet2Active && !s.bet2CashedOut && mult >= s.autoCashout2) {
          s.cashoutBet2();
          playCoinSound();
        }

        if (mult >= cp) {
          clearInterval(flyingIntervalRef.current);
          // Mark remaining live bets as lost
          const finalState = store.getState();
          finalState.liveBets.forEach(b => {
            if (b.status === 'betting') {
              finalState.updateLiveBet(b.id, { status: 'lost', won: false });
            }
          });
          finalState.setCurrentMultiplier(parseFloat(cp.toFixed(2)));
          finalState.setGamePhase('crashed');
          finalState.addRoundHistory({ id: Date.now().toString(), crashPoint: cp, timestamp: Date.now() });
          playCrashSound();

          // Update online users randomly
          setTimeout(() => {
            store.getState().setOnlineUsers(Math.floor(Math.random() * 96) + 320);
            store.getState().resetBets();
            // Auto-bet for next round
            const ns = store.getState();
            if (ns.autoBet1 && ns.balance >= ns.bet1Amount) ns.placeBet1();
            if (ns.autoBet2 && ns.balance >= ns.bet2Amount) ns.placeBet2();
            setTimeout(startRound, 3000);
          }, 2500);
        }
      }, 50);
    }

    startRound();

    return () => {
      clearInterval(flyingIntervalRef.current);
      clearInterval(waitingIntervalRef.current);
      isRunningRef.current = false;
    };
  }, []);
}

// ─── Win Popup ───────────────────────────────────────────────────────────────
function WinPopup() {
  const showWinPopup = useGameStore(s => s.showWinPopup);
  const winAmount = useGameStore(s => s.winAmount);
  const winMultiplier = useGameStore(s => s.winMultiplier);
  const hideWin = useGameStore(s => s.hideWin);

  useEffect(() => {
    if (showWinPopup) {
      const t = setTimeout(hideWin, 3000);
      return () => clearTimeout(t);
    }
  }, [showWinPopup, hideWin]);

  return (
    <AnimatePresence>
      {showWinPopup && (
        <motion.div
          initial={{ opacity: 0, scale: 0.5, y: 50 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.5, y: -50 }}
          className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-8 py-4 rounded-2xl shadow-2xl text-center border-2 border-green-400"
        >
          <p className="text-sm font-bold uppercase tracking-wider opacity-80">YOU WON!</p>
          <p className="text-4xl font-black font-mono">KSH {winAmount.toFixed(0)}</p>
          <p className="text-xs opacity-80 mt-1">@ {winMultiplier.toFixed(2)}x multiplier</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Round History Bar ────────────────────────────────────────────────────────
function RoundHistoryBar() {
  const roundHistory = useGameStore(s => s.roundHistory);

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {roundHistory.slice(0, 15).map((round, i) => (
        <motion.div
          key={round.id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.05 * i }}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap flex-shrink-0 ${
            round.crashPoint >= 10 ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
            round.crashPoint >= 5  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
            round.crashPoint >= 2  ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
                                     'bg-red-500/20 text-red-300 border border-red-500/30'
          }`}
        >
          {round.crashPoint.toFixed(2)}x
        </motion.div>
      ))}
    </div>
  );
}

// ─── Betting Panels ────────────────────────────────────────────────────────────
function BetPanel({ betNum }) {
  const store = useGameStore;
  const { playCoinSound, playBetSound } = useAudio();

  const betAmount = useGameStore(s => betNum === 1 ? s.bet1Amount : s.bet2Amount);
  const betActive = useGameStore(s => betNum === 1 ? s.bet1Active : s.bet2Active);
  const betCashedOut = useGameStore(s => betNum === 1 ? s.bet1CashedOut : s.bet2CashedOut);
  const cashoutMult = useGameStore(s => betNum === 1 ? s.bet1CashoutMultiplier : s.bet2CashoutMultiplier);
  const autoBet = useGameStore(s => betNum === 1 ? s.autoBet1 : s.autoBet2);
  const autoCashoutEnabled = useGameStore(s => betNum === 1 ? s.autoCashout1Enabled : s.autoCashout2Enabled);
  const autoCashout = useGameStore(s => betNum === 1 ? s.autoCashout1 : s.autoCashout2);
  const gamePhase = useGameStore(s => s.gamePhase);
  const balance = useGameStore(s => s.balance);

  const setBetAmount = betNum === 1 ? store.getState().setBet1Amount : store.getState().setBet2Amount;
  const placeBet = betNum === 1 ? () => store.getState().placeBet1() : () => store.getState().placeBet2();
  const cashoutBet = betNum === 1 ? () => store.getState().cashoutBet1() : () => store.getState().cashoutBet2();
  const setAutoBet = betNum === 1 ? (v) => store.getState().setAutoBet1(v) : (v) => store.getState().setAutoBet2(v);
  const setAutoCashoutEnabled = betNum === 1
    ? (v) => store.getState().setAutoCashout1Enabled(v)
    : (v) => store.getState().setAutoCashout2Enabled(v);
  const setAutoCashout = betNum === 1
    ? (v) => store.getState().setAutoCashout1(v)
    : (v) => store.getState().setAutoCashout2(v);

  const presets = [50, 100, 200, 500];

  const canBet = !betActive && gamePhase === 'waiting' && balance >= betAmount;
  const canCashout = betActive && !betCashedOut && gamePhase === 'flying';

  const handleBet = () => {
    if (canBet) {
      placeBet();
      playBetSound();
    }
  };

  const handleCashout = () => {
    if (canCashout) {
      cashoutBet();
      playCoinSound();
    }
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Bet {betNum}</span>
        {betCashedOut && cashoutMult && (
          <span className="text-[10px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full">
            Won @ {cashoutMult.toFixed(2)}x
          </span>
        )}
      </div>

      {/* Bet Amount Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => useGameStore.getState()[betNum === 1 ? 'setBet1Amount' : 'setBet2Amount'](betAmount - 10)}
          disabled={betActive || betAmount <= 10}
          className="w-9 h-9 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl flex items-center justify-center text-gray-300 font-bold disabled:opacity-40 transition"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1 bg-slate-950/50 border border-slate-700 rounded-xl text-center py-2 font-mono font-bold text-white text-base">
          KSH {betAmount.toLocaleString()}
        </div>
        <button
          onClick={() => useGameStore.getState()[betNum === 1 ? 'setBet1Amount' : 'setBet2Amount'](betAmount + 10)}
          disabled={betActive}
          className="w-9 h-9 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl flex items-center justify-center text-gray-300 font-bold disabled:opacity-40 transition"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Quick Presets */}
      <div className="grid grid-cols-4 gap-1.5">
        {presets.map(p => (
          <button
            key={p}
            onClick={() => useGameStore.getState()[betNum === 1 ? 'setBet1Amount' : 'setBet2Amount'](p)}
            disabled={betActive}
            className="py-1.5 text-[11px] font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-gray-300 transition disabled:opacity-40"
          >
            {p >= 1000 ? `${p/1000}k` : p}
          </button>
        ))}
      </div>

      {/* Auto-cashout toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAutoCashoutEnabled(!autoCashoutEnabled)}
          className={`relative w-9 h-5 rounded-full transition ${autoCashoutEnabled ? 'bg-yellow-500' : 'bg-slate-700'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${autoCashoutEnabled ? 'left-4' : 'left-0.5'}`} />
        </button>
        <span className="text-xs text-gray-400">Auto Cashout</span>
        {autoCashoutEnabled && (
          <input
            type="number"
            value={autoCashout}
            onChange={e => setAutoCashout(Math.max(1.01, parseFloat(e.target.value) || 1.01))}
            step="0.1" min="1.01"
            className="ml-auto w-20 bg-slate-950/50 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-yellow-400 text-center focus:outline-none focus:border-yellow-500"
          />
        )}
      </div>

      {/* Auto-bet toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setAutoBet(!autoBet)}
          className={`relative w-9 h-5 rounded-full transition ${autoBet ? 'bg-green-500' : 'bg-slate-700'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${autoBet ? 'left-4' : 'left-0.5'}`} />
        </button>
        <span className="text-xs text-gray-400">Auto Bet</span>
      </div>

      {/* Bet / Cashout Button */}
      {canCashout ? (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleCashout}
          className="w-full py-3.5 bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-slate-950 font-black text-base rounded-xl shadow-lg transition"
        >
          CASH OUT
        </motion.button>
      ) : betActive && !betCashedOut ? (
        <div className="w-full py-3.5 bg-slate-700/60 border border-slate-700 text-gray-400 font-bold text-sm rounded-xl text-center">
          Bet Active — Flying...
        </div>
      ) : (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleBet}
          disabled={!canBet}
          className="w-full py-3.5 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-black text-base rounded-xl shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {gamePhase === 'flying' ? 'Wait for next round' : `BET KSH ${betAmount.toLocaleString()}`}
        </motion.button>
      )}
    </div>
  );
}

// ─── Live Bets Table ──────────────────────────────────────────────────────────
function LiveBetsTable() {
  const liveBets = useGameStore(s => s.liveBets);
  const onlineUsers = useGameStore(s => s.onlineUsers);

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="flex justify-between items-center px-4 py-3 border-b border-slate-800/60">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Live Bets</h3>
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Users className="w-3.5 h-3.5 text-green-500" />
          <span className="text-green-400 font-semibold">{onlineUsers}</span> online
        </div>
      </div>
      <div className="overflow-y-auto max-h-48">
        {liveBets.map(bet => (
          <div key={bet.id} className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/40 last:border-0">
            <span className="text-xs text-gray-300 font-semibold truncate max-w-[100px]">{bet.username}</span>
            <span className="text-xs font-mono text-yellow-400">KSH {bet.stake.toLocaleString()}</span>
            {bet.cashedOutAt ? (
              <span className="text-xs font-bold text-green-400">✓ {bet.cashedOutAt.toFixed(2)}x</span>
            ) : bet.status === 'lost' ? (
              <span className="text-xs font-bold text-red-400">✗</span>
            ) : (
              <span className="text-xs text-gray-500 animate-pulse">Flying...</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Bet History Table ────────────────────────────────────────────────────────
function BetHistoryTable() {
  const betHistory = useGameStore(s => s.betHistory);

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800/60">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <History className="w-3.5 h-3.5" /> My Bet History
        </h3>
      </div>
      <div className="overflow-y-auto max-h-52">
        {betHistory.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-500 text-xs">No bets placed yet</div>
        ) : betHistory.map((bet, i) => (
          <div key={bet.id + i} className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/40 last:border-0 text-xs">
            <span className="text-gray-400 font-mono">{new Date(bet.timestamp).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="text-yellow-400 font-mono">KSH {bet.stake}</span>
            <span className={bet.status === 'won' ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
              {bet.status === 'won' ? `${bet.oddsAtCashout?.toFixed(2)}x` : `${bet.oddsAtCrash?.toFixed(2)}x`}
            </span>
            <span className={`font-bold ${bet.status === 'won' ? 'text-green-400' : 'text-red-400'}`}>
              {bet.status === 'won' ? 'WIN' : 'LOSS'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter();
  const { user, isLoggedIn, logout } = useAuthStore();
  const balance = useGameStore(s => s.balance);
  const onlineUsers = useGameStore(s => s.onlineUsers);

  const [showChat, setShowChat] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [activeTab, setActiveTab] = useState('live'); // live | history

  // Mount the game engine
  useGameEngine();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (typeof window !== 'undefined' && !isLoggedIn) {
      // Small delay to allow Zustand hydration
      const t = setTimeout(() => {
        if (!useAuthStore.getState().isLoggedIn) {
          router.push('/login');
        }
      }, 500);
      return () => clearTimeout(t);
    }
  }, [isLoggedIn, router]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white font-sans">
      <WinPopup />

      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-lg border-b border-slate-800/60">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <Link href="/" className="flex-shrink-0">
            <Image src="/cashjet-logo.png" alt="CashJet" width={120} height={38} className="h-9 sm:h-11 w-auto" />
          </Link>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Balance Display */}
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2">
              <Wallet className="w-4 h-4 text-green-400" />
              <span className="font-black font-mono text-green-400 text-sm sm:text-base">
                KSH {balance.toLocaleString()}
              </span>
            </div>

            {/* Deposit button */}
            <button
              onClick={() => setShowDeposit(true)}
              className="bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-slate-950 font-extrabold px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm transition shadow-md"
            >
              + Deposit
            </button>

            {/* Withdraw button */}
            <button
              onClick={() => setShowWithdraw(true)}
              className="hidden sm:flex bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-extrabold px-4 py-2 rounded-xl text-sm transition shadow-md items-center gap-1"
            >
              Withdraw
            </button>

            {/* Chat toggle */}
            <button
              onClick={() => setShowChat(!showChat)}
              className="relative bg-slate-800 hover:bg-slate-700 border border-slate-700 p-2 rounded-xl transition"
            >
              <MessageCircle className="w-4 h-4 text-gray-300" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
            </button>

            {/* Logout */}
            <button onClick={handleLogout} className="bg-slate-800 hover:bg-red-900/30 border border-slate-700 p-2 rounded-xl transition">
              <LogOut className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content Layout */}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">

        {/* Left Column: Game + Betting */}
        <div className="space-y-4">
          {/* Round History Bar */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl px-4 py-2.5 overflow-hidden">
            <RoundHistoryBar />
          </div>

          {/* Game Canvas */}
          <GameCanvas />

          {/* Welcome banner with username */}
          {user && (
            <div className="bg-gradient-to-r from-slate-900/60 to-slate-800/40 border border-slate-800 rounded-2xl px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">Welcome back,</p>
                <p className="text-base font-extrabold text-white">{user.name || 'Player'} 👋</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Users className="w-3.5 h-3.5 text-green-500" />
                <span className="text-green-400 font-bold">{onlineUsers}</span> playing now
              </div>
            </div>
          )}

          {/* Dual Betting Panels */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <BetPanel betNum={1} />
            <BetPanel betNum={2} />
          </div>

          {/* Withdraw button (mobile) */}
          <button
            onClick={() => setShowWithdraw(true)}
            className="sm:hidden w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-extrabold py-3.5 rounded-xl text-sm transition shadow-md"
          >
            Withdraw Winnings
          </button>

          {/* Tabbed: Live Bets / History */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('live')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${activeTab === 'live' ? 'bg-yellow-500 text-slate-950' : 'bg-slate-800 text-gray-400 hover:bg-slate-700'}`}
              >
                Live Bets
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${activeTab === 'history' ? 'bg-yellow-500 text-slate-950' : 'bg-slate-800 text-gray-400 hover:bg-slate-700'}`}
              >
                My History
              </button>
            </div>
            {activeTab === 'live' ? <LiveBetsTable /> : <BetHistoryTable />}
          </div>
        </div>

        {/* Right Column: Chat */}
        <div className="hidden lg:flex flex-col h-[640px]">
          <LiveChat />
        </div>
      </div>

      {/* Mobile Chat Drawer */}
      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            className="fixed inset-y-0 right-0 w-80 z-50 lg:hidden shadow-2xl"
          >
            <div className="h-full">
              <button
                onClick={() => setShowChat(false)}
                className="absolute top-4 left-4 z-10 bg-slate-800 border border-slate-700 p-2 rounded-full text-gray-400 hover:text-white"
              >
                ✕
              </button>
              <LiveChat />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} />
      <WithdrawModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} />
    </div>
  );
}
