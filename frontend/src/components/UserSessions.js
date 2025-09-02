// src/components/UserSessions.js
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../config';

function UserSessions({ userId, sessionToken, onLoadSession }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadSessions = useCallback(async () => {
    if (!userId || !sessionToken) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Updated endpoint to match backend: fetch user sessions
      const data = await apiFetch(`/user-sessions/${userId}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      setSessions(data.sessions || []);
    } catch (err) {
      console.error('Error loading sessions:', err);
      setError(err.message || 'Error loading saved sessions');
    } finally {
      setLoading(false);
    }
  }, [userId, sessionToken]);

  useEffect(() => {
    if (userId && sessionToken) loadSessions();
  }, [userId, sessionToken, loadSessions]);

  const handleLoadSession = (session) => {
    if (onLoadSession) onLoadSession(session);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!userId || !sessionToken) {
    return (
      <div className="p-4 border rounded-2xl shadow-md bg-white dark:bg-gray-800">
        <h3 className="text-lg font-bold mb-2 text-gray-800 dark:text-gray-200">
          Saved Sessions
        </h3>
        <p className="text-gray-500 dark:text-gray-400">Please login to view saved sessions.</p>
      </div>
    );
  }

  return (
    <div className="p-4 border rounded-2xl shadow-md bg-white dark:bg-gray-800">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200">Saved Sessions</h3>
        <button
          onClick={loadSessions}
          disabled={loading}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50 flex items-center gap-1"
        >
          {loading ? (
            <>
              <span className="animate-spin">⟳</span> Loading...
            </>
          ) : (
            'Refresh'
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 p-2 rounded mb-3 text-sm">
          {error}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📁</div>
          <p>No saved sessions yet.</p>
          <p className="text-sm mt-1">Your chat sessions will appear here after you save them.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {sessions.map((session, index) => (
            <div
              key={index}
              className="border border-gray-200 dark:border-gray-600 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <h4 className="font-semibold text-gray-800 dark:text-gray-200 truncate">
                {session.title || 'Untitled Session'}
              </h4>

              <div className="flex justify-between items-center mt-2 text-xs text-gray-500 dark:text-gray-400">
                <span>Saved: {formatDate(session.saved_at)}</span>
                <span>{session.history?.length || 0} messages</span>
              </div>

              <div className="mt-3 flex justify-between items-center">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  ID: {session.session_id.slice(0, 8)}...
                </span>
                <button
                  onClick={() => handleLoadSession(session)}
                  className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition-colors"
                  title="Load this session"
                >
                  Load
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-600">
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          {sessions.length} saved session{sessions.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}

export default UserSessions;
