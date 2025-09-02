import React, { useState } from "react";
import { API_BASE_URL } from "../config";

function UploadPDFs({ setSessionId, sessionToken }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e) => {
    setFiles(e.target.files);
  };

  const handleUpload = async () => {
    if (!files.length) {
      alert("Please select PDF files first!");
      return;
    }
    if (!sessionToken) {
      alert("You must be logged in to upload files.");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }

    try {
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`, // Attach token
        },
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");

      setSessionId(data.session_id); // Store sessionId for chat
      alert(data.message);

      // ✅ Optional: Fetch existing messages for this session
      /*
      const chatResp = await fetch(`${API_BASE_URL}/get-chat-messages/${data.session_id}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (chatResp.ok) {
        const messages = await chatResp.json();
        // You can now pass these messages to your chat component to initialize history
      }
      */
    } catch (err) {
      console.error("Upload error:", err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-700">
      <h3 className="text-lg font-semibold mb-2">Upload PDFs</h3>
      <input
        type="file"
        accept="application/pdf"
        multiple
        onChange={handleFileChange}
        className="mb-3"
      />
      <button
        onClick={handleUpload}
        disabled={uploading || !files.length}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {uploading ? "Uploading..." : "Upload"}
      </button>
    </div>
  );
}

export default UploadPDFs;
