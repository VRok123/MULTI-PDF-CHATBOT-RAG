// src/components/VoiceInput.js
import React, { useState, useRef } from 'react';
import { API_BASE_URL } from '../config';

function VoiceInput({ onTextRecognized, onStartListening, onStopListening }) {
  const [isListening, setIsListening] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [status, setStatus] = useState('idle');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const startListening = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Voice input is not supported in this browser.");
      return;
    }

    setStatus('starting');
    if (onStartListening) onStartListening();
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        setStatus('processing');
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Create URL for playback
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        
        // Send to server for speech-to-text
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.webm');
        
        try {
          const response = await fetch(`${API_BASE_URL}/speech-to-text`, {
            method: 'POST',
            body: formData,
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data.text && onTextRecognized) {
              onTextRecognized(data.text);
            }
            setStatus('success');
          } else {
            throw new Error('Speech recognition failed');
          }
        } catch (err) {
          console.error('Error with speech-to-text:', err);
          setStatus('error');
          alert('Speech recognition failed. Please try again or type your question.');
        }
      };

      mediaRecorderRef.current.start();
      setIsListening(true);
      setStatus('listening');
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setStatus('error');
      alert('Could not access microphone. Please check permissions.');
      if (onStopListening) onStopListening();
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && isListening) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsListening(false);
      setStatus('processing');
      if (onStopListening) onStopListening();
    }
  };

  const playAudio = () => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play();
    }
  };

  const getButtonColor = () => {
    switch (status) {
      case 'listening': return 'bg-red-500 hover:bg-red-600';
      case 'processing': return 'bg-yellow-500 hover:bg-yellow-600';
      case 'success': return 'bg-green-500 hover:bg-green-600';
      case 'error': return 'bg-red-500 hover:bg-red-600';
      default: return 'bg-blue-500 hover:bg-blue-600';
    }
  };

  const getButtonIcon = () => {
    switch (status) {
      case 'listening': return '🔴';
      case 'processing': return '⏳';
      case 'success': return '✅';
      case 'error': return '❌';
      default: return '🎤';
    }
  };

  const getButtonTitle = () => {
    switch (status) {
      case 'listening': return 'Stop listening (click again to stop)';
      case 'processing': return 'Processing your speech...';
      case 'success': return 'Speech recognized successfully';
      case 'error': return 'Error occurred - click to try again';
      default: return 'Start voice input';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={isListening ? stopListening : startListening}
        disabled={status === 'processing'}
        className={`p-2 rounded-full text-white transition-colors ${getButtonColor()} disabled:opacity-50`}
        title={getButtonTitle()}
      >
        <span className="text-sm">{getButtonIcon()}</span>
      </button>
      
      {audioUrl && status !== 'processing' && (
        <button
          onClick={playAudio}
          className="p-2 rounded-full bg-gray-500 hover:bg-gray-600 text-white transition-colors"
          title="Play recorded audio"
        >
          <span className="text-sm">▶️</span>
        </button>
      )}
      
      {status === 'processing' && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Processing...
        </div>
      )}
    </div>
  );
}

export default VoiceInput;