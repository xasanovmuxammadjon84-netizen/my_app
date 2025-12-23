
import React, { useState, useEffect, useRef } from 'react';
import { 
  Globe, Languages, MapPin, MessageSquare, Search, Volume2, Navigation, Compass, Loader2, Send,
  Sparkles, ArrowRight, Star, VolumeX, Menu, X, RefreshCw, ShieldCheck, CreditCard, Zap, Mic, MicOff, Settings as SettingsIcon, Trash2, CheckCircle
} from 'lucide-react';
import { AppTab, Place, TranslationResult, ChatMessage, LANGUAGES, AppSettings } from './types';
import { translateAndSpeak, discoverPlaces, aiTravelAgent, decodeBase64Audio, speakText, getAI, encode, decode } from './services/geminiService';
import { Modality } from "@google/genai";

const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('gt_v5_settings');
      return saved ? JSON.parse(saved) : { preferredLanguage: 'O\'zbekcha', isPremium: false, hasOnboarded: false, theme: 'light' };
    } catch (e) {
      return { preferredLanguage: 'O\'zbekcha', isPremium: false, hasOnboarded: false, theme: 'light' };
    }
  });

  const [activeTab, setActiveTab] = useState<AppTab>(AppTab.EXPLORE);
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [relatedQueries, setRelatedQueries] = useState<string[]>([]);
  
  const [transText, setTransText] = useState('');
  const [fromLang, setFromLang] = useState('English');
  const [toLang, setToLang] = useState(settings.preferredLanguage);
  const [transResult, setTransResult] = useState<TranslationResult | null>(null);
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Live API refs
  const liveSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());

  useEffect(() => {
    localStorage.setItem('gt_v5_settings', JSON.stringify(settings));
    document.documentElement.className = settings.theme;
  }, [settings]);

  useEffect(() => {
    if (activeTab === AppTab.AI_GUIDE) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, isTyping, activeTab]);

  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  const playAudio = async (base64: string) => {
    initAudio();
    if (!audioCtxRef.current) return;
    setIsSpeaking(true);
    try {
      const buffer = await decodeBase64Audio(base64, audioCtxRef.current);
      const source = audioCtxRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtxRef.current.destination);
      source.onended = () => setIsSpeaking(false);
      source.start();
    } catch (e) {
      console.error(e);
      setIsSpeaking(false);
    }
  };

  const startLiveVoice = async () => {
    if (!settings.isPremium) {
      setShowPremiumModal(true);
      return;
    }
    initAudio();
    setIsLiveActive(true);
    const ai = getAI();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = audioCtxRef.current!;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then(s => s.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg) => {
            const base64 = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              const buffer = await decodeBase64Audio(base64, outputCtx);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
          },
          onclose: () => setIsLiveActive(false),
          onerror: () => setIsLiveActive(false),
        },
        config: { 
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: 'Siz aqlli sayohat gidisiz. Foydalanuvchi bilan ovozli muloqot qiling. Maslahatlaringiz juda samimiy bo\'lsin.'
        }
      });
      liveSessionRef.current = await sessionPromise;
    } catch (e) {
      console.error(e);
      setIsLiveActive(false);
    }
  };

  const stopLiveVoice = () => {
    liveSessionRef.current?.close();
    setIsLiveActive(false);
  };

  const handleExplore = async (q: string = searchQuery) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearchQuery(q);
    try {
      const data = await discoverPlaces(q, settings.preferredLanguage);
      setPlaces(data.places);
      setRelatedQueries(data.relatedQueries);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleTranslate = async () => {
    if (!transText.trim()) return;
    setLoading(true);
    try {
      const { translatedText, base64Audio } = await translateAndSpeak(transText, fromLang, toLang);
      setTransResult({ originalText: transText, translatedText, fromLang, toLang });
      if (base64Audio) await playAudio(base64Audio);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg, timestamp: Date.now() }]);
    setLoading(true);
    setIsTyping(true);
    try {
      const response = await aiTravelAgent(userMsg, settings.preferredLanguage, chatHistory);
      const content = String(response.text) + (response.links?.length ? "\n\nManbalar:\n" + response.links.join("\n") : "");
      setChatHistory(prev => [...prev, { role: 'model', content, timestamp: Date.now() }]);
      
      if (response.text.length < 350) {
        const audio = await speakText(response.text);
        if (audio) await playAudio(audio);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setIsTyping(false);
    }
  };

  const togglePremium = () => {
    setSettings(s => ({ ...s, isPremium: !s.isPremium }));
    setShowPremiumModal(false);
  };

  const resetApp = () => {
    if (confirm("Ilovani tozalashni tasdiqlaysizmi? Barcha sozlamalar va tarix o'chib ketadi.")) {
      localStorage.removeItem('gt_v5_settings');
      window.location.reload();
    }
  };

  if (!settings.hasOnboarded) {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center p-6 z-[100]">
        <div className="absolute inset-0 overflow-hidden opacity-50">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-blue-600/20 blur-[150px] rounded-full"></div>
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-600/20 blur-[100px] rounded-full"></div>
        </div>
        <div className="relative w-full max-w-lg bg-white/5 backdrop-blur-3xl border border-white/10 p-10 rounded-[50px] shadow-2xl text-center space-y-10 animate-fade-in">
          <div className="mx-auto w-28 h-28 bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center rounded-[35px] shadow-2xl">
            <Globe className="text-white" size={56} />
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-black text-white tracking-tighter">GlobeTalker AI</h1>
            <p className="text-blue-100/60 font-bold text-lg uppercase tracking-widest">Global Travel Intelligence</p>
          </div>
          <div className="grid grid-cols-2 gap-4 max-h-[300px] overflow-y-auto p-4 custom-scrollbar bg-white/5 rounded-[30px]">
            {LANGUAGES.map((lang) => (
              <button
                key={String(lang.code)}
                onClick={() => setSettings(s => ({ ...s, preferredLanguage: String(lang.name) }))}
                className={`py-4 px-6 rounded-2xl border transition-all font-black text-sm ${settings.preferredLanguage === lang.name ? 'bg-blue-600 text-white border-blue-500 shadow-xl' : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'}`}
              >
                {String(lang.name)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setSettings(s => ({ ...s, hasOnboarded: true }))}
            className="w-full bg-white text-slate-950 py-6 rounded-[30px] font-black text-xl shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3"
          >
            Boshlash <ArrowRight size={24} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col min-h-screen ${settings.theme === 'dark' ? 'bg-slate-900 text-white' : 'bg-[#F8FAFC] text-slate-900'}`}>
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-slate-200/60 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4 cursor-pointer" onClick={() => setActiveTab(AppTab.EXPLORE)}>
          <div className="bg-slate-950 p-3 rounded-2xl text-white shadow-xl">
            <Globe size={24} />
          </div>
          <h1 className="text-2xl font-black tracking-tighter">GlobeTalker</h1>
          {settings.isPremium && (
            <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-white px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-lg flex items-center gap-1">
              <Zap size={10} fill="white" /> Plus
            </div>
          )}
        </div>

        <nav className="hidden md:flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
          {[AppTab.EXPLORE, AppTab.TRANSLATE, AppTab.AI_GUIDE].map((tab) => (
            <button
              key={String(tab)}
              onClick={() => setActiveTab(tab)}
              className={`px-8 py-2.5 rounded-xl text-xs font-black tracking-widest transition-all uppercase ${activeTab === tab ? 'bg-white text-blue-600 shadow-sm scale-105' : 'text-slate-400 hover:text-slate-700'}`}
            >
              {String(tab)}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => setActiveTab(AppTab.SETTINGS)}
            className={`p-3 rounded-xl transition-all ${activeTab === AppTab.SETTINGS ? 'bg-slate-950 text-white shadow-xl' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
          >
            <SettingsIcon size={24} />
          </button>
          {!settings.isPremium && (
            <button 
              onClick={() => setShowPremiumModal(true)}
              className="hidden sm:flex items-center gap-2 px-6 py-3 bg-slate-950 rounded-2xl text-xs font-black text-white hover:bg-blue-600 transition-all shadow-2xl"
            >
              <Zap size={14} fill="white" /> Plus
            </button>
          )}
          <button className="md:hidden p-3 bg-slate-100 rounded-xl text-slate-600" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full pb-20">
        {activeTab === AppTab.EXPLORE && (
          <div className="space-y-16 animate-fade-in">
            {/* Hero Section */}
            <div className="relative pt-24 pb-32 px-6 overflow-hidden bg-slate-950 rounded-b-[80px] shadow-[0_50px_100px_rgba(0,0,0,0.3)]">
              <div className="absolute inset-0 opacity-40">
                <div className="absolute top-0 left-1/4 w-[700px] h-[700px] bg-blue-600/40 blur-[180px] rounded-full"></div>
                <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-indigo-700/40 blur-[150px] rounded-full"></div>
              </div>

              <div className="relative z-10 max-w-4xl mx-auto text-center space-y-10">
                <div className="inline-flex items-center gap-3 bg-white/5 backdrop-blur-2xl px-6 py-3 rounded-full border border-white/10 text-blue-300 text-[10px] font-black uppercase tracking-[0.3em] shadow-2xl">
                  <Sparkles size={16} className="text-blue-400" /> Sayohatning Yangi Davri
                </div>
                <h2 className="text-6xl md:text-9xl font-black text-white tracking-tighter leading-[0.85]">
                  Dunyoni <span className="text-transparent bg-clip-text bg-gradient-to-br from-blue-400 via-indigo-400 to-purple-400">Haqiqiy</span> <br /> ko'z bilan ko'ring
                </h2>
                
                <form 
                  onSubmit={(e) => { e.preventDefault(); handleExplore(); }} 
                  className="relative mt-16 max-w-3xl mx-auto group"
                >
                  <div className="absolute -inset-2 bg-gradient-to-r from-blue-600 to-purple-600 rounded-[40px] blur-2xl opacity-20 group-focus-within:opacity-40 transition duration-1000"></div>
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Masalan: O'zbekiston yoki Parij"
                    className="relative w-full bg-white px-20 py-8 rounded-[35px] outline-none text-2xl font-black transition-all shadow-2xl placeholder:text-slate-300 focus:ring-8 focus:ring-blue-500/10 text-slate-900"
                  />
                  <Search className="absolute left-8 top-1/2 -translate-y-1/2 text-blue-600" size={32} />
                  <button 
                    type="submit"
                    disabled={loading}
                    className="absolute right-4 top-4 bottom-4 bg-slate-950 text-white px-12 rounded-[28px] font-black text-lg hover:bg-blue-600 disabled:bg-slate-300 transition-all flex items-center gap-3 shadow-2xl"
                  >
                    {loading ? <Loader2 className="animate-spin" size={24} /> : "Izlash"}
                  </button>
                </form>

                {/* Google-Style Related Search Suggestions */}
                {relatedQueries.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-4 pt-10 animate-fade-in">
                    <p className="w-full text-white/40 text-[10px] font-black uppercase tracking-[0.4em] mb-4">O'xshash qidiruvlar:</p>
                    {relatedQueries.map((q, idx) => (
                      <button 
                        key={idx}
                        onClick={() => handleExplore(q)}
                        className="bg-white/5 hover:bg-white/20 backdrop-blur-xl text-white px-6 py-3 rounded-full text-sm font-black border border-white/10 transition-all hover:scale-105 flex items-center gap-3 group"
                      >
                        <Search size={14} className="text-blue-400 group-hover:scale-125 transition-transform" /> {String(q)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Results Grid */}
            <div className="px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
              {places.length > 0 ? places.map((place, i) => (
                <div key={i} className={`group rounded-[55px] overflow-hidden border transition-all hover:-translate-y-6 hover:shadow-[0_60px_100px_rgba(0,0,0,0.1)] ${settings.theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100 shadow-[0_30px_60px_rgba(0,0,0,0.05)]'}`}>
                  <div className="relative h-[400px]">
                    <img 
                        src={place.imageUrl} 
                        alt={String(place.name)} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000" 
                        loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent"></div>
                    <div className="absolute top-8 left-8 bg-white/95 backdrop-blur px-6 py-2.5 rounded-2xl flex items-center gap-2 shadow-2xl border border-white">
                      <Star size={18} className="text-amber-500 fill-amber-500" />
                      <span className="text-base font-black text-slate-950">{String(place.rating)}</span>
                    </div>
                    <div className="absolute bottom-10 left-10 right-10">
                      <div className="flex items-center gap-2 text-blue-400 text-[11px] font-black uppercase tracking-[0.3em] mb-3">
                        <MapPin size={14} /> {String(place.location)}
                      </div>
                      <h3 className="text-4xl font-black text-white leading-tight tracking-tighter">{String(place.name)}</h3>
                    </div>
                  </div>
                  <div className="p-12 space-y-10">
                    <p className={`leading-relaxed font-bold text-xl line-clamp-4 ${settings.theme === 'dark' ? 'text-slate-300' : 'text-slate-600'}`}>{String(place.description)}</p>
                    <div className="flex gap-4">
                        <a 
                        href={String(place.mapLink)} 
                        target="_blank" 
                        className="flex-1 inline-flex items-center justify-center gap-4 bg-slate-950 text-white py-6 rounded-[28px] font-black text-lg hover:bg-blue-600 transition-all shadow-2xl"
                        >
                        <Navigation size={24} /> Xaritada
                        </a>
                        <button 
                            onClick={() => {
                                setActiveTab(AppTab.AI_GUIDE);
                                setChatInput(`${place.name} haqida batafsil ma'lumot ber.`);
                            }}
                            className={`p-6 rounded-[28px] transition-all shadow-sm active:scale-90 ${settings.theme === 'dark' ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                        >
                            <Sparkles size={28} />
                        </button>
                    </div>
                  </div>
                </div>
              )) : !loading && searchQuery && (
                <div className="col-span-full py-40 text-center flex flex-col items-center gap-10 animate-fade-in">
                  <div className="p-20 bg-white/5 rounded-full shadow-inner border border-white/10">
                    <Compass size={120} className="animate-spin-slow opacity-20 text-blue-400" />
                  </div>
                  <div className="space-y-4">
                    <p className="font-black text-4xl tracking-tighter">Ma'lumot topilmadi</p>
                    <p className="text-slate-400 font-bold text-xl">Boshqa so'rov yozing.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Translation Section */}
        {activeTab === AppTab.TRANSLATE && (
          <div className="max-w-5xl mx-auto px-6 py-12 space-y-12 animate-fade-in">
             <div className={`p-12 sm:p-20 rounded-[70px] border shadow-2xl space-y-16 relative overflow-hidden ${settings.theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto,1fr] items-center gap-10 relative z-10">
                <select 
                  value={fromLang} 
                  onChange={(e) => setFromLang(e.target.value)}
                  className={`w-full border-4 p-8 rounded-3xl font-black outline-none focus:border-blue-500 transition-all text-2xl shadow-sm appearance-none ${settings.theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-900'}`}
                >
                  {LANGUAGES.map(l => <option key={String(l.code)} value={String(l.name)}>{String(l.name)}</option>)}
                </select>
                <div className="flex justify-center bg-slate-950 p-6 rounded-full shadow-2xl text-white transform hover:rotate-180 transition-transform cursor-pointer" onClick={() => {
                    const temp = fromLang;
                    setFromLang(toLang);
                    setToLang(temp);
                }}>
                    <RefreshCw size={32} />
                </div>
                <select 
                  value={toLang} 
                  onChange={(e) => setToLang(e.target.value)}
                  className={`w-full border-4 p-8 rounded-3xl font-black outline-none focus:border-blue-500 transition-all text-2xl shadow-sm appearance-none ${settings.theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-900'}`}
                >
                  {LANGUAGES.map(l => <option key={String(l.code)} value={String(l.name)}>{String(l.name)}</option>)}
                </select>
              </div>

              <textarea 
                value={transText}
                onChange={(e) => setTransText(e.target.value)}
                placeholder="Bu yerga yozing..."
                className={`w-full h-80 border-4 p-14 rounded-[60px] outline-none focus:border-blue-500 text-4xl font-black transition-all resize-none shadow-inner ${settings.theme === 'dark' ? 'bg-slate-900 border-slate-700 text-white placeholder:text-slate-700' : 'bg-slate-50 border-slate-100 text-slate-900 placeholder:text-slate-200'}`}
              />

              <button 
                onClick={handleTranslate}
                disabled={loading || !transText.trim()}
                className="w-full bg-blue-600 text-white py-10 rounded-[40px] font-black text-3xl shadow-2xl hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-6 transition-all"
              >
                {loading ? <Loader2 className="animate-spin" size={40} /> : <><Sparkles size={40} /> Tarjima Qilish</>}
              </button>
            </div>

            {transResult && (
              <div className={`p-16 rounded-[70px] border-l-[30px] border-blue-600 shadow-2xl space-y-12 animate-fade-in relative overflow-hidden ${settings.theme === 'dark' ? 'bg-slate-800' : 'bg-white'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black uppercase tracking-[0.5em] text-blue-600 bg-blue-50 px-6 py-3 rounded-full">AI Translation Result</span>
                  <button 
                    onClick={() => handleTranslate()}
                    disabled={isSpeaking}
                    className={`p-8 rounded-[35px] transition-all shadow-2xl ${isSpeaking ? 'bg-blue-100 text-blue-600 animate-pulse' : 'bg-slate-950 text-white hover:bg-blue-600'}`}
                  >
                    {isSpeaking ? <VolumeX size={36} /> : <Volume2 size={36} />}
                  </button>
                </div>
                <p className="text-6xl font-black leading-tight tracking-tighter">{String(transResult.translatedText)}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === AppTab.AI_GUIDE && (
          <div className="max-w-6xl mx-auto px-6 py-6 h-[88vh] flex flex-col">
             <div className={`flex-1 flex flex-col rounded-[70px] border shadow-2xl overflow-hidden animate-fade-in relative ${settings.theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                <div className="bg-slate-950 p-12 flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-8">
                      <div className="bg-gradient-to-tr from-blue-500 via-indigo-600 to-purple-600 p-6 rounded-[30px] text-white shadow-2xl ring-8 ring-white/10">
                        {isLiveActive ? <Mic size={36} className="animate-pulse" /> : <MessageSquare size={36} />}
                      </div>
                      <div>
                        <h3 className="font-black text-3xl text-white tracking-tighter">AI Shaxsiy Gid</h3>
                        <div className="flex items-center gap-3 mt-2">
                            <span className={`w-3 h-3 rounded-full animate-pulse ${isLiveActive ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
                            <span className="text-[11px] text-slate-400 font-black uppercase tracking-[0.3em]">{isLiveActive ? 'Live Voice Active' : 'Ready'}</span>
                        </div>
                      </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={isLiveActive ? stopLiveVoice : startLiveVoice}
                      className={`px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl flex items-center gap-3 ${isLiveActive ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                    >
                      {isLiveActive ? <MicOff size={18} /> : <Mic size={18} />}
                      {isLiveActive ? "Voice Off" : "Voice On"}
                    </button>
                  </div>
                </div>

                <div className={`flex-1 overflow-y-auto p-14 space-y-12 custom-scrollbar ${settings.theme === 'dark' ? 'bg-slate-900/50' : 'bg-[#FBFDFF]'}`}>
                {chatHistory.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-12 opacity-30">
                      <div className="relative">
                        <div className={`p-20 rounded-[80px] shadow-inner ${settings.theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'}`}>
                            <Mic size={120} className="text-slate-400" />
                        </div>
                        <Compass size={100} className="text-blue-200 absolute -top-10 -left-10 animate-spin-slow" />
                      </div>
                    </div>
                )}
                {chatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] p-9 rounded-[45px] leading-relaxed font-bold shadow-2xl text-2xl ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : (settings.theme === 'dark' ? 'bg-slate-700 text-white rounded-tl-none' : 'bg-white text-slate-900 border border-slate-100 rounded-tl-none')}`}>
                        <p className="whitespace-pre-wrap">{String(msg.content)}</p>
                    </div>
                    </div>
                ))}
                {isTyping && (
                    <div className="flex justify-start">
                    <div className={`p-8 rounded-[35px] rounded-tl-none border flex gap-4 items-center shadow-xl ${settings.theme === 'dark' ? 'bg-slate-700 border-slate-600' : 'bg-white border-slate-100'}`}>
                        <div className="w-4 h-4 bg-blue-500 rounded-full animate-bounce" />
                        <div className="w-4 h-4 bg-blue-500 rounded-full animate-bounce delay-150" />
                        <div className="w-4 h-4 bg-blue-500 rounded-full animate-bounce delay-300" />
                    </div>
                    </div>
                )}
                <div ref={chatEndRef} />
                </div>

                <div className={`p-12 border-t ${settings.theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                <div className={`flex gap-6 p-6 rounded-[50px] border-4 focus-within:border-blue-500/20 transition-all shadow-inner items-center ${settings.theme === 'dark' ? 'bg-slate-900 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
                    <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                    placeholder="Savol bering..."
                    className="flex-1 bg-transparent px-6 py-5 outline-none font-black text-3xl"
                    />
                    <button 
                    onClick={handleChat}
                    disabled={loading || !chatInput.trim()}
                    className="bg-slate-950 text-white p-8 rounded-full hover:bg-blue-600 disabled:bg-slate-200 transition-all shadow-2xl active:scale-90"
                    >
                    <Send size={36} />
                    </button>
                </div>
                </div>
            </div>
          </div>
        )}

        {activeTab === AppTab.SETTINGS && (
          <div className="max-w-4xl mx-auto px-6 py-12 space-y-12 animate-fade-in">
            <h2 className="text-5xl font-black tracking-tighter mb-10">Sozlamalar</h2>
            
            <div className={`p-12 rounded-[50px] border shadow-2xl space-y-12 ${settings.theme === 'dark' ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
              {/* Premium Status */}
              <div className="flex items-center justify-between p-8 rounded-[30px] bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-xl">
                <div className="flex items-center gap-6">
                  <div className="bg-amber-400 p-4 rounded-2xl text-slate-950 shadow-lg">
                    <Zap size={32} fill="currentColor" />
                  </div>
                  <div>
                    <h4 className="text-2xl font-black">Plus Obunasi</h4>
                    <p className="text-slate-400 font-bold">{settings.isPremium ? "Siz Premium foydalanuvchisiz!" : "Premiumga ulaning va cheksiz imkoniyatlarga ega bo'ling."}</p>
                  </div>
                </div>
                {!settings.isPremium ? (
                  <button onClick={() => setShowPremiumModal(true)} className="bg-white text-slate-950 px-8 py-4 rounded-2xl font-black shadow-lg hover:scale-105 transition-all">
                    Upgrade $19.99
                  </button>
                ) : (
                  <div className="flex items-center gap-2 text-emerald-400 font-black">
                    <CheckCircle size={24} /> Faol
                  </div>
                )}
              </div>

              {/* Language Selection */}
              <div className="space-y-6">
                <label className="text-sm font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Languages size={18} /> Ilova tili
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {LANGUAGES.map(lang => (
                    <button 
                      key={lang.code}
                      onClick={() => setSettings(s => ({ ...s, preferredLanguage: lang.name }))}
                      className={`p-5 rounded-2xl border-2 font-black transition-all ${settings.preferredLanguage === lang.name ? 'bg-blue-600 text-white border-blue-500 shadow-xl' : (settings.theme === 'dark' ? 'bg-slate-900 border-slate-700 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-600')}`}
                    >
                      {lang.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme Selection */}
              <div className="space-y-6">
                <label className="text-sm font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Sparkles size={18} /> Mavzu
                </label>
                <div className="flex gap-4">
                  <button 
                    onClick={() => setSettings(s => ({ ...s, theme: 'light' }))}
                    className={`flex-1 p-6 rounded-3xl border-4 font-black transition-all flex items-center justify-center gap-3 ${settings.theme === 'light' ? 'bg-white border-blue-500 shadow-xl text-slate-900' : 'bg-slate-100 border-transparent text-slate-400'}`}
                  >
                    Light
                  </button>
                  <button 
                    onClick={() => setSettings(s => ({ ...s, theme: 'dark' }))}
                    className={`flex-1 p-6 rounded-3xl border-4 font-black transition-all flex items-center justify-center gap-3 ${settings.theme === 'dark' ? 'bg-slate-900 border-blue-500 shadow-xl text-white' : 'bg-slate-100 border-transparent text-slate-400'}`}
                  >
                    Dark
                  </button>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="pt-10 border-t border-slate-200/20">
                <button onClick={resetApp} className="w-full flex items-center justify-center gap-3 py-6 rounded-3xl bg-red-50 text-red-600 font-black hover:bg-red-100 transition-all">
                  <Trash2 size={24} /> Ma'lumotlarni tozalash
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Premium Upgrade Modal */}
      {showPremiumModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/95 backdrop-blur-2xl animate-fade-in">
          <div className="relative w-full max-w-xl bg-white rounded-[80px] shadow-[0_60px_120px_rgba(0,0,0,0.6)] overflow-hidden border border-white/20">
            <button onClick={() => setShowPremiumModal(false)} className="absolute top-10 right-10 p-4 bg-slate-100 rounded-full text-slate-500 hover:text-slate-950 transition-all z-10">
              <X size={28} />
            </button>
            <div className="bg-slate-950 p-20 text-center space-y-8 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-600/30 via-transparent to-purple-600/30 animate-pulse"></div>
              <Zap size={100} className="mx-auto fill-amber-400 text-amber-400 animate-bounce relative z-10" />
              <div className="space-y-4 relative z-10">
                <h3 className="text-5xl font-black tracking-tighter text-white uppercase italic">GlobeTalker Plus</h3>
                <p className="text-blue-300 font-black text-xl tracking-widest uppercase">The Ultimate Travel Companion</p>
              </div>
              <div className="text-7xl font-black text-white relative z-10 tracking-tighter">
                $19.99 <span className="text-2xl text-slate-500 font-black">/oy</span>
              </div>
            </div>
            <div className="p-16 space-y-12">
              <div className="space-y-8">
                {[
                  { icon: Mic, text: "AI Ovozli Muloqot (Real-time Voice Mode)", color: "text-blue-600 bg-blue-50" },
                  { icon: Sparkles, text: "Google-Search & Aniq Rasmlar", color: "text-purple-600 bg-purple-50" },
                  { icon: ShieldCheck, text: "Reklamasiz Premium Interfeys", color: "text-emerald-600 bg-emerald-50" },
                  { icon: Zap, text: "Eksklyuziv Gid Ma'lumotlari", color: "text-amber-600 bg-amber-50" }
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-6 text-slate-950 font-black text-2xl">
                    <div className={`${item.color} p-5 rounded-[25px] shadow-sm`}><item.icon size={32} /></div>
                    {String(item.text)}
                  </div>
                ))}
              </div>
              <button 
                onClick={togglePremium}
                className="w-full bg-slate-950 text-white py-10 rounded-[45px] font-black text-3xl hover:bg-blue-600 transition-all shadow-3xl transform active:scale-95"
              >
                Hozir Faollashtirish
              </button>
              <p className="text-center text-slate-400 text-sm font-black uppercase tracking-[0.4em]">Bez reklama va xavfsiz to'lov</p>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Nav Mobile */}
      <footer className={`md:hidden sticky bottom-0 z-50 glass border-t border-slate-200/60 p-10 rounded-t-[70px] shadow-[0_-30px_60px_rgba(0,0,0,0.05)] flex justify-around ${settings.theme === 'dark' ? 'bg-slate-800' : 'bg-white'}`}>
        {[
          { tab: AppTab.EXPLORE, icon: Compass, label: 'Kashf' },
          { tab: AppTab.TRANSLATE, icon: Languages, label: 'Tarjima' },
          { tab: AppTab.AI_GUIDE, icon: MessageSquare, label: 'AI Gid' }
        ].map((item) => (
          <button 
            key={String(item.tab)}
            onClick={() => setActiveTab(item.tab)}
            className={`flex flex-col items-center gap-3 transition-all duration-500 ${activeTab === item.tab ? 'text-blue-600 scale-125' : 'text-slate-400'}`}
          >
            <item.icon size={34} />
            <span className={`text-[11px] font-black uppercase tracking-[0.3em] ${activeTab === item.tab ? 'opacity-100' : 'opacity-30'}`}>{String(item.label)}</span>
          </button>
        ))}
      </footer>
    </div>
  );
};

export default App;
