import os, json, asyncio, hashlib, secrets, uuid
from fastapi import FastAPI, UploadFile, File, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, Response
from pydantic import BaseModel
from typing import List
from PyPDF2 import PdfReader
from datetime import datetime, timedelta
import requests
import base64
from collections import defaultdict
from dotenv import load_dotenv

# Database imports
from sqlalchemy import create_engine, Column, String, Text, DateTime, JSON, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from sqlalchemy import text

from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate
from langchain_openai import ChatOpenAI

load_dotenv()

# ========== DATABASE SETUP ==========
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(64), nullable=False)
    email = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    sessions = relationship("ChatSession", back_populates="user")

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey('users.id'), nullable=False)
    title = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    user = relationship("User", back_populates="sessions")
    messages = relationship("ChatMessage", back_populates="session")

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey('chat_sessions.id'), nullable=False)
    sender = Column(String(20), nullable=False)
    message_text = Column(Text, nullable=False)
    citations = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    session = relationship("ChatSession", back_populates="messages")

class UserSession(Base):
    __tablename__ = "user_sessions"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey('users.id'), nullable=False)
    session_token = Column(String(100), unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    expires_at = Column(DateTime, nullable=False)

DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
    print("✅ Database tables created successfully")

init_db()

# ========== CONFIG ==========
embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

llm = ChatOpenAI(
    model="openai/gpt-oss-20b",
    openai_api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_API_BASE"),
    temperature=0
)

prompt_template = """You are a precise data extraction assistant. Follow these rules carefully:

1. **Source of Truth**: Only use the CONTEXT below. Do not invent or assume anything.
2. **Tables**:
   - If the context has tables (Markdown or plain text), return rows *exactly as they appear* (columns preserved).
   - Do not drop rows (even if the quantity is 0, missing, or very large).
   - If the user requests a subset (e.g., "items with quantity > 10"), filter but preserve the original row format.
3. **Verbatim Extraction**:
   - Copy text exactly, without rewording or summarizing.
   - Preserve numbers, currencies, and units exactly.
4. **Not Found Case**:
   - If the requested item/row/data is not in the CONTEXT, respond with only: `Not found`.
5. **Multiple Test Cases**:
   - If the question is ambiguous, provide *all possible matches*.
   - If multiple tables exist, indicate clearly which table each answer came from.
6. **Formatting**:
   - Always use Markdown for tables.
   - For plain lists, keep line breaks as in the original.
   - Never mix tables and free text unless explicitly asked.

### Examples

**Example 1 (table retrieval):**
User: "Show me the row with Quantity = 100"
Context contains:

| Item | Quantity | Cost |
|------|----------|------|
| A    | 1        | $10  |
| B    | 100      | $50  |

Answer:
| Item | Quantity | Cost |
|------|----------|------|
| B    | 100      | $50  |

---

**Example 2 (not found):**
User: "Show me Quantity = 200"
Context contains the same table.
Answer:
Not found

---

**Example 3 (multiple rows):**
User: "List all items with Quantity >= 50"
Context contains:

| Item | Quantity | Cost |
|------|----------|------|
| A    | 1        | $10  |
| B    | 50       | $20  |
| C    | 100      | $30  |

Answer:
| Item | Quantity | Cost |
|------|----------|------|
| B    | 50       | $20  |
| C    | 100      | $30  |

Context:
{context}

Question: {question}
Answer:"""
prompt = PromptTemplate(template=prompt_template, input_variables=["context", "question"])

vectorstore_dict = {}
qa_chain_dict = {}
qa_history_dict = {}

# ========== MODELS ==========
class UserRegister(BaseModel):
    username: str
    password: str
    email: str

class UserLogin(BaseModel):
    username: str
    password: str

class AskRequest(BaseModel):
    question: str
    session_id: str

class ExportRequest(BaseModel):
    session_id: str
    format: str = "json"

# ========== APP ==========
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== AUTH ==========
async def verify_token(request: Request, db: Session = Depends(get_db)):
    token = request.headers.get("Authorization")
    if not token or not token.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid token")
    token = token[7:]
    user_session = db.query(UserSession).filter(
        UserSession.session_token == token,
        UserSession.expires_at > datetime.now()
    ).first()
    if not user_session:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query(User).filter(User.id == user_session.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return {"user_id": user.id, "username": user.username}

# ========== LOAD SAVED SESSIONS ==========
@app.on_event("startup")
def load_saved_sessions():
    print("🔹 Loading saved chat sessions from database...")
    db = SessionLocal()
    try:
        sessions = db.query(ChatSession).all()
        for s in sessions:
            session_id = s.id
            qa_history_dict[session_id] = []
            messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).all()
            for m in messages:
                qa_history_dict[session_id].append({
                    "q": m.message_text if m.sender=='user' else '',
                    "a": m.message_text if m.sender=='ai' else '',
                    "citations": m.citations
                })
        print(f"✅ Loaded {len(sessions)} sessions from database")
    except Exception as e:
        print(f"⚠️ Error loading sessions: {e}")
    finally:
        db.close()

# ==================== USER ENDPOINTS ====================
@app.post("/register")
async def register(user: UserRegister, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.username == user.username).first()
    if existing_user:
        return JSONResponse({"error": "Username already exists"}, status_code=400)
    password_hash = hashlib.sha256(user.password.encode()).hexdigest()
    new_user = User(username=user.username, password_hash=password_hash, email=user.email)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return JSONResponse({"message": "User created successfully", "user_id": new_user.id})

@app.post("/login")
async def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user:
        return JSONResponse({"error": "Invalid username or password"}, status_code=401)
    password_hash = hashlib.sha256(user.password.encode()).hexdigest()
    if db_user.password_hash != password_hash:
        return JSONResponse({"error": "Invalid username or password"}, status_code=401)
    session_token = secrets.token_urlsafe(32)
    expires_at = datetime.now() + timedelta(days=7)
    user_session = UserSession(user_id=db_user.id, session_token=session_token, expires_at=expires_at)
    db.add(user_session)
    db.commit()
    return JSONResponse({"message": "Login successful", "session_token": session_token, "user_id": db_user.id})

@app.get("/user-sessions/{user_id}")
async def get_user_sessions(user_id: str, session: dict = Depends(verify_token), db: Session = Depends(get_db)):
    if session["user_id"] != user_id:
        return JSONResponse({"error": "Unauthorized"}, status_code=403)
    sessions = db.query(ChatSession).filter(ChatSession.user_id == user_id).all()
    return JSONResponse({
        "sessions": [
            {"session_id": s.id, "title": s.title, "created_at": s.created_at.isoformat(), "updated_at": s.updated_at.isoformat()}
            for s in sessions
        ]
    })

# ==================== GET CHAT MESSAGES ====================
@app.get("/chat-messages/{session_id}")
async def get_chat_messages(session_id: str, db: Session = Depends(get_db)):
    """
    Fetch saved chat messages for a given session ID.
    Returns messages in chronological order with sender and citations.
    """
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at).all()
    
    return JSONResponse({
        "session_id": session_id,
        "messages": [
            {
                "id": m.id,
                "sender": m.sender,
                "text": m.message_text,
                "citations": m.citations,
                "created_at": m.created_at.isoformat()
            }
            for m in messages
        ]
    })


# ==================== UPLOAD PDF ====================
@app.post("/upload")
async def upload(request: Request, files: List[UploadFile] = File(...), db: Session = Depends(get_db), session: dict = Depends(verify_token)):
    texts, metadatas = [], []
    for file in files:
        try:
            pdf = PdfReader(file.file)
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text:
                    texts.append(text)
                    metadatas.append({"source": file.filename, "page": i+1})
        except Exception as e:
            return JSONResponse({"error": f"Error processing {file.filename}: {str(e)}"}, status_code=400)
    if not texts:
        return JSONResponse({"error": "No text could be extracted from the PDFs"}, status_code=400)
    try:
        vectorstore = FAISS.from_texts(texts, embeddings, metadatas=metadatas)
        retriever = vectorstore.as_retriever(search_kwargs={"k": 6})
        qa_chain = RetrievalQA.from_chain_type(llm=llm, retriever=retriever, chain_type="stuff", return_source_documents=True)
        sid = str(uuid.uuid4())
        vectorstore_dict[sid] = vectorstore
        qa_chain_dict[sid] = qa_chain
        qa_history_dict[sid] = []
        new_session = ChatSession(id=sid, user_id=session["user_id"], title=f"Session - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        db.add(new_session)
        db.commit()
        return {"session_id": sid, "message": f"Files uploaded and processed. {len(texts)} pages indexed."}
    except Exception as e:
        return JSONResponse({"error": f"Error creating vector store: {str(e)}"}, status_code=500)

# ==================== ASK QUESTIONS ====================
@app.post("/ask")
async def ask(payload: AskRequest):
    session_id = payload.session_id
    question = payload.question.strip()
    if not session_id or session_id not in qa_chain_dict:
        return JSONResponse({"error": "Invalid session ID. Please upload PDFs first."}, status_code=400)
    if not question:
        return JSONResponse({"error": "No question provided."}, status_code=400)
    qa_chain = qa_chain_dict[session_id]
    try:
        result = qa_chain.invoke({"query": question})
        answer = result["result"] if isinstance(result, dict) else str(result)
        source_docs = result.get("source_documents", [])
        citations = []
        for doc in source_docs:
            meta = getattr(doc, "metadata", {})
            page_content = doc.page_content
            best_match = ""
            question_words = question.lower().split()
            for word in question_words:
                if len(word) < 4: continue
                idx = page_content.lower().find(word.lower())
                if idx != -1:
                    start = max(0, idx-50)
                    end = min(len(page_content), idx+len(word)+100)
                    snippet = page_content[start:end]
                    if len(snippet) > len(best_match): best_match = snippet
            preview_text = best_match if best_match else page_content
            citations.append({"source": meta.get("source","Unknown"), "page": meta.get("page",1), "preview": preview_text, "full_text": page_content})
        qa_history_dict[session_id].append({"q": question, "a": answer, "citations": citations})
        async def streamer():
            for line in answer.split("\n"):
                yield line + "\n"
                await asyncio.sleep(0.05)
            yield "\n\n---__CITATIONS__---\n"
            yield json.dumps(citations)

        return StreamingResponse(streamer(), media_type="text/plain")
    except Exception as e:
        return JSONResponse({"error": f"Error processing question: {str(e)}"}, status_code=500)

# ==================== SAVE CHAT ====================
@app.post("/save-chat")
async def save_chat(request: Request, db: Session = Depends(get_db)):
    try:
        body = await request.json()
        session_id = body.get("session_id")
        messages = body.get("messages", [])
        if not session_id or not messages:
            raise HTTPException(status_code=400, detail="session_id and messages are required")
        for msg in messages:
            sender = msg.get("sender", "").lower()
            text = msg.get("text", "")
            if not sender or not text:
                continue
            db_msg = ChatMessage(
                session_id=session_id,
                sender="user" if sender in ["you", "user"] else "ai",
                message_text=text,
                citations=msg.get("citations")
            )
            db.add(db_msg)
        db.commit()
        return {"status": "success", "message": "Chat saved successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving chat: {str(e)}")

# ==================== EXPORT CHAT ====================
@app.post("/export-chat")
async def export_chat(payload: ExportRequest):
    if payload.session_id not in qa_history_dict:
        return JSONResponse({"error": "Invalid session ID"}, status_code=400)
    history = qa_history_dict[payload.session_id]
    if payload.format == "json":
        return JSONResponse(history)
    elif payload.format == "txt":
        text_content = "Chat Export\n===========\n\n"
        for i, item in enumerate(history):
            text_content += f"Q{i+1}: {item['q']}\nA{i+1}: {item['a']}\n"
            if item['citations']:
                text_content += "Sources:\n"
                for cit in item['citations']:
                    text_content += f"  - {cit['source']} (p.{cit['page']}): {cit['preview']}\n"
            text_content += "\n"
        return Response(content=text_content, media_type="text/plain",
                        headers={"Content-Disposition": f"attachment; filename=chat_export_{payload.session_id}.txt"})
    else:
        return JSONResponse({"error": "Unsupported format"}, status_code=400)

# ==================== DOCUMENT ANALYSIS ====================
@app.get("/document-analysis/{session_id}")
async def document_analysis(session_id: str):
    if session_id not in vectorstore_dict:
        return JSONResponse({"error": "Invalid session ID"}, status_code=400)
    vectorstore = vectorstore_dict[session_id]
    try:
        all_docs = []
        try:
            for i in range(vectorstore.index.ntotal):
                doc_id = vectorstore.index_to_docstore_id[i]
                doc = vectorstore.docstore.search(doc_id)
                if doc and hasattr(doc,'metadata'):
                    all_docs.append({'source':doc.metadata.get('source','Unknown'),
                                     'page':doc.metadata.get('page',1),
                                     'content_preview':doc.page_content[:100]+'...' if len(doc.page_content)>100 else doc.page_content})
        except:
            for doc_id, doc in vectorstore.docstore._dict.items():
                if hasattr(doc,'metadata'):
                    all_docs.append({'source':doc.metadata.get('source','Unknown'),
                                     'page':doc.metadata.get('page',1),
                                     'content_preview':doc.page_content[:100]+'...' if len(doc.page_content)>100 else doc.page_content})
        sources = defaultdict(list)
        for doc in all_docs:
            sources[doc['source']].append(doc)
        return JSONResponse({"document_count": len(all_docs), "source_count": len(sources), "sources": dict(sources)})
    except Exception as e:
        return JSONResponse({"error": f"Error analyzing documents: {str(e)}"}, status_code=500)

# ==================== TEXT TO SPEECH ====================
@app.post("/text-to-speech")
async def text_to_speech(request: dict):
    text = request.get("text", "")
    if not text:
        return JSONResponse({"error": "No text provided"}, status_code=400)
    try:
        tts_url = f"https://translate.google.com/translate_tts?ie=UTF-8&q={text}&tl=en&client=tw-ob"
        response = requests.get(tts_url)
        if response.status_code==200:
            audio_base64 = base64.b64encode(response.content).decode('utf-8')
            return JSONResponse({"audio": audio_base64})
        else:
            return JSONResponse({"error": "TTS service error"}, status_code=500)
    except Exception as e:
        return JSONResponse({"error": f"TTS failed: {str(e)}"}, status_code=500)

# ==================== SPEECH TO TEXT ====================
@app.post("/speech-to-text")
async def speech_to_text(file: UploadFile = File(...)):
    try:
        await file.read()
        return JSONResponse({"text": "This is a placeholder for speech-to-text functionality."})
    except Exception as e:
        return JSONResponse({"error": f"STT failed: {str(e)}"}, status_code=500)

# ==================== HEALTH ====================
@app.get("/health")
async def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"
    return {"status": "healthy","database":db_status,"timestamp":datetime.now().isoformat()}

# ==================== TEST AUTH ====================
@app.get("/test-auth")
async def test_auth(session: dict = Depends(verify_token)):
    return {"user": session, "authenticated": True}

# ==================== RUN APP ====================
if __name__=="__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
