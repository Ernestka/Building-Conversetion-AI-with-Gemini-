
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Message, ConversationState } from './types';
import { decode, encode, decodeAudioData, createPcmBlob } from './services/audioUtils';

const SYSTEM_INSTRUCTION = `You are a helpful and patient English Language Tutor. 
Your goal is to help the user practice speaking English. 
- Keep your responses concise and natural.
- If the user makes a clear grammatical error, gently point it out and suggest the correct version.
- Encourage them to keep talking by asking open-ended questions.
- Use a friendly, encouraging tone.`;

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [showAbout, setShowAbout] = useState(false);
  const [convState, setConvState] = useState<ConversationState>({
    isActive: false,
    isConnecting: false,
    error: null,
  });

  // Refs for audio processing
  const sessionRef = useRef<any>(null);
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const currentInputTranscriptRef = useRef<string>('');
  const currentOutputTranscriptRef = useRef<string>('');

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const stopConversation = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextInRef.current) {
      audioContextInRef.current.close();
      audioContextInRef.current = null;
    }
    if (audioContextOutRef.current) {
      audioContextOutRef.current.close();
      audioContextOutRef.current = null;
    }
    setConvState({ isActive: false, isConnecting: false, error: null });
  }, []);

  const startConversation = async () => {
    setConvState(prev => ({ ...prev, isConnecting: true, error: null }));
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      audioContextInRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextOutRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const outNode = audioContextOutRef.current.createGain();
      outNode.connect(audioContextOutRef.current.destination);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setConvState({ isActive: true, isConnecting: false, error: null });
            const source = audioContextInRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextInRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextInRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && audioContextOutRef.current) {
              const ctx = audioContextOutRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outNode);
              
              source.onended = () => sourcesRef.current.delete(source);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.inputTranscription) {
              currentInputTranscriptRef.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscriptRef.current += message.serverContent.outputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userText = currentInputTranscriptRef.current;
              const aiText = currentOutputTranscriptRef.current;

              if (userText) {
                setMessages(prev => [...prev, {
                  id: Math.random().toString(),
                  text: userText,
                  sender: 'user',
                  timestamp: new Date()
                }]);
              }
              if (aiText) {
                setMessages(prev => [...prev, {
                  id: Math.random().toString(),
                  text: aiText,
                  sender: 'ai',
                  timestamp: new Date()
                }]);
              }

              currentInputTranscriptRef.current = '';
              currentOutputTranscriptRef.current = '';
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Live API Error:', e);
            setConvState(prev => ({ ...prev, error: 'Connection error occurred.' }));
            stopConversation();
          },
          onclose: () => {
            setConvState({ isActive: false, isConnecting: false, error: null });
          },
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error(err);
      setConvState({ isActive: false, isConnecting: false, error: err.message || 'Failed to start microphone.' });
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8 bg-slate-950 text-slate-100">
      <div className="w-full max-w-4xl glass rounded-3xl overflow-hidden shadow-2xl flex flex-col h-[85vh]">
        
        {/* Header */}
        <header className="p-6 border-b border-white/10 flex items-center justify-between bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Fluentify AI</h1>
              <p className="text-xs text-slate-400 font-medium uppercase tracking-widest">English Language Coach</p>
            </div>
          </div>
          <button 
            onClick={() => setShowAbout(true)}
            className="text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-full border border-white/10 transition-colors"
          >
            About Developer
          </button>
        </header>

        {/* Chat Area */}
        <main ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar scroll-smooth">
          {messages.length === 0 && !convState.isActive && !convState.isConnecting && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 px-12">
              <div className="p-4 bg-sky-500/10 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold">Start your practice session</h2>
              <p className="text-slate-400 max-w-sm">
                Tap the button below to start a real-time voice conversation. I'll listen to your English and help you improve.
              </p>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${
                m.sender === 'user' 
                  ? 'bg-sky-600 text-white rounded-tr-none' 
                  : 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700'
              }`}>
                <p className="text-sm leading-relaxed">{m.text}</p>
                <span className="text-[10px] opacity-50 mt-2 block">
                  {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {convState.isActive && (
            <div className="flex justify-center py-4">
              <div className="audio-wave">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="wave-bar" style={{ animationDelay: `${i * 0.1}s`, height: `${10 + Math.random() * 25}px` }}></div>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Footer / Controls */}
        <footer className="p-6 bg-slate-900/80 border-t border-white/5 backdrop-blur-md">
          {convState.error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              {convState.error}
            </div>
          )}

          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-sm text-slate-400 order-2 md:order-1">
              {convState.isActive ? 'I am listening... go ahead and speak!' : 'Click the button to start speaking'}
            </div>
            
            <div className="order-1 md:order-2">
              {!convState.isActive ? (
                <button
                  onClick={startConversation}
                  disabled={convState.isConnecting}
                  className={`px-8 py-3 rounded-full font-bold transition-all transform hover:scale-105 flex items-center gap-3 shadow-xl ${
                    convState.isConnecting 
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                      : 'bg-sky-500 hover:bg-sky-400 text-white shadow-sky-500/20'
                  }`}
                >
                  {convState.isConnecting ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <div className="w-3 h-3 rounded-full bg-white animate-pulse"></div>
                      Start Voice Session
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={stopConversation}
                  className="px-8 py-3 rounded-full bg-red-500 hover:bg-red-400 text-white font-bold transition-all transform hover:scale-105 flex items-center gap-3 shadow-xl shadow-red-500/20"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                  </svg>
                  End Session
                </button>
              )}
            </div>
          </div>
        </footer>
      </div>
      
      {/* Tips */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl text-xs text-slate-500 font-medium">
        <div className="glass p-3 rounded-xl flex items-center gap-3">
          <span className="text-sky-400">01</span>
          <span>Practice daily to improve fluency</span>
        </div>
        <div className="glass p-3 rounded-xl flex items-center gap-3">
          <span className="text-sky-400">02</span>
          <span>Ask me about grammar rules</span>
        </div>
        <div className="glass p-3 rounded-xl flex items-center gap-3">
          <span className="text-sky-400">03</span>
          <span>I can help with pronunciation</span>
        </div>
      </div>

      {/* About Me Modal */}
      {showAbout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 p-8 rounded-3xl max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-bold mb-4 text-sky-400">About Me</h2>
            <div className="space-y-4 text-slate-300 leading-relaxed">
              <p>
                This app has been created by <strong>Ernest Katembo Muhasa</strong>, a student at <strong>AIMS Africa (African Institute for Mathematical Sciences) Cameroon</strong>.
              </p>
              <p>
                My mission is to help fellow students and language learners practice English speaking for <strong>free</strong>, using cutting-edge AI technology to bridge the communication gap.
              </p>
            </div>
            <button 
              onClick={() => setShowAbout(false)}
              className="mt-8 w-full py-3 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
