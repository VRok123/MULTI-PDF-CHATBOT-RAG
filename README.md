cat > README.md << 'EOF'
# RAG GPT-OSS-20B App

This project is a **Retrieval-Augmented Generation (RAG) application** powered by **openai/gpt-oss-20b via OpenRouter**.  
It allows users to upload multiple PDFs, ask questions, and get context-aware answers with source attribution.  

## Features
- 📄 Multi-PDF Upload & Processing  
- 💬 Session-aware Chat History  
- ⚡ Streaming Responses  
- 📑 Source Attribution (which PDF/section the answer comes from)  
- 🎨 React Frontend + FastAPI Backend  

## Tech Stack
- **Backend**: Python, FastAPI, LangChain, OpenRouter (openai/gpt-oss-20b)  
- **Frontend**: React.js, Tailwind CSS  
- **Storage**: FAISS (for embeddings), SQLite/MySQL (for session data)  

## Getting Started
### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
