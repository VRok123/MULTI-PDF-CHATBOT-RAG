// src/components/VoiceOutput.js
import React, { useState } from 'react';
import { apiFetch } from '../config';

function VoiceOutput({ text }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');

  // Renamed from useBrowserTTS to browserTTS
  const browserTTS = () => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 200)); // Limit length
      utterance.onend = () => setIsPlaying(false);
      utterance.onerror = (e) => {
        console.error('Speech synthesis error:', e);
        setIsPlaying(false);
        setError('Text-to-speech not available');
      };
      speechSynthesis.speak(utterance);
    } else {
      setIsPlaying(false);
      setError('Text-to-speech not supported');
    }
  };

  const speakText = async () => {
    if (!text) return;
    
    setIsPlaying(true);
    setError('');
    
    try {
      // Try server-based TTS first
      const data = await apiFetch('/text-to-speech', {
        method: 'POST',
        body: JSON.stringify({ text: text.slice(0, 200) }), // Limit length for demo
      });
      
      if (data.audio) {
        // Decode base64 audio and play it
        const audio = new Audio(`data:audio/mp3;base64,${data.audio}`);
        audio.onended = () => setIsPlaying(false);
        audio.onerror = () => {
          setIsPlaying(false);
          browserTTS(); // Use the renamed function
        };
        audio.play();
        return;
      }
      
      // Fallback to browser's built-in speech synthesis
      browserTTS(); // Use the renamed function
      
    } catch (err) {
      console.error('Error with text-to-speech:', err);
      browserTTS(); // Use the renamed function
    }
  };

  if (!text) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={speakText}
        disabled={isPlaying}
        className={`p-1 rounded-full ${
          isPlaying ? 'bg-yellow-500' : 'bg-green-500 hover:bg-green-600'
        } text-white transition-colors disabled:opacity-50`}
        title={isPlaying ? 'Reading aloud...' : 'Read aloud'}
      >
        <span className="text-xs">{isPlaying ? '🔊' : '🔈'}</span>
      </button>
      
      {error && (
        <span className="text-xs text-red-500" title={error}>
          ⚠️
        </span>
      )}
    </div>
  );
}

export default VoiceOutput;