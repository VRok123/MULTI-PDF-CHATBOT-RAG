// src/components/DocumentAnalysis.js
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../config';

function DocumentAnalysis({ sessionId }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Use useCallback to memoize the function
  const fetchAnalysis = useCallback(async () => {
    if (!sessionId) {
      setError('No session ID available');
      return;
    }
    
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/document-analysis/${sessionId}`);
      setAnalysis(data);
    } catch (err) {
      console.error("Error fetching analysis:", err);
      setError(err.message || 'Error loading document analysis');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) {
      fetchAnalysis();
    }
  }, [sessionId, fetchAnalysis]);

  if (!sessionId) {
    return (
      <div className="p-4 border rounded-2xl shadow-md bg-white dark:bg-gray-800">
        <h3 className="text-lg font-bold mb-2">Document Analysis</h3>
        <p className="text-gray-500 dark:text-gray-400">Upload PDFs to see document analysis.</p>
      </div>
    );
  }

  return (
    <div className="p-4 border rounded-2xl shadow-md bg-white dark:bg-gray-800">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-lg font-bold">Document Analysis</h3>
        <button 
          onClick={fetchAnalysis}
          disabled={loading}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      
      {error && (
        <div className="bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 p-2 rounded mb-3">
          {error}
        </div>
      )}
      
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : analysis ? (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold">{analysis.document_count}</div>
              <div className="text-sm">Text Chunks</div>
            </div>
            <div className="bg-green-100 dark:bg-green-900 p-3 rounded-lg text-center">
              <div className="text-2xl font-bold">{analysis.source_count}</div>
              <div className="text-sm">PDF Files</div>
            </div>
          </div>
          
          <div className="mt-4">
            <h4 className="font-semibold mb-2 text-gray-800 dark:text-gray-200">Uploaded Documents:</h4>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {Object.entries(analysis.sources).map(([source, pages]) => (
                <div key={source} className="bg-gray-100 dark:bg-gray-700 p-3 rounded-lg">
                  <h5 className="font-medium text-gray-800 dark:text-gray-200 truncate">
                    {source}
                  </h5>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {pages.length} page{pages.length !== 1 ? 's' : ''}
                  </p>
                  
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <div className="font-medium">Sample content:</div>
                    <div className="truncate italic">
                      {pages[0]?.content_preview || 'No content available'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 dark:text-gray-400">No analysis available. Click refresh to load.</p>
      )}
    </div>
  );
}

export default DocumentAnalysis;