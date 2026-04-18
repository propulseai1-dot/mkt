from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, String, Float, Text, Integer, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel
from typing import Optional, List
import secrets
from datetime import datetime
import httpx

# --- INITIALISATION ---
app = FastAPI(title="SilkGenesis Command Center")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- DATABASE SETUP ---
DATABASE_URL = "sqlite:///./silkgenesis.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- MODELS SQLALCHEMY ---
class User(Base):
    __tablename__ = "users"
    username = Column(String, primary_key=True, index=True)
    password = Column(String)  
    role = Column(String)      # 'buyer', 'vendor', 'admin'
    status = Column(String, default="active") # 'active', 'banned'
    balance = Column(Float, default=0.0)
    pos_reviews = Column(Integer, default=0)
    xmr_address = Column(String, unique=True)
    avatar = Column(Text, nullable=True)     

class Category(Base):
    __tablename__ = "categories"
    name = Column(String, primary_key=True, index=True)
    parent = Column(String, nullable=True)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    sender = Column(String)
    text = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)

class Listing(Base):
    __tablename__ = "listings"
    id = Column(String, primary_key=True, index=True)
    title = Column(String)
    price_xmr = Column(Float)
    category = Column(String)
    vendor = Column(String)
    description = Column(Text)
    image = Column(Text, nullable=True)

Base.metadata.create_all(bind=engine)

# --- SCHEMAS PYDANTIC ---
class WithdrawRequest(BaseModel):
    username: str
    address: str
    amount: float

class PurchaseRequest(BaseModel):
    listing_id: str
    buyer_username: str

class UserAction(BaseModel):
    username: str
    password: Optional[str] = None
    role: Optional[str] = "buyer"
    avatar: Optional[str] = None

class LoginRequest(BaseModel):
    username: str
    password: str
    pow_solution: Optional[str] = None 

class ListingCreate(BaseModel):
    title: str
    price_xmr: float
    category: str
    description: str
    vendor: str
    image: Optional[str] = None

# --- UTILS ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def generate_real_xmr_address():
    chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    suffix = "".join(secrets.choice(chars) for _ in range(94))
    return "4" + suffix

async def get_xmr_usd_rate():
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd", timeout=5.0)
            return float(resp.json()["monero"]["usd"])
    except Exception:
        return 165.0  

# --- ROUTES : AUTHENTICATION ---

@app.post("/api/register")
def register(data: LoginRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="Identity already claimed")
    new_user = User(username=data.username, password=data.password, role="buyer", balance=0.0, status="active", xmr_address=generate_real_xmr_address())
    db.add(new_user)
    db.commit()
    return {"status": "success"}

@app.post("/api/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if user and user.password == data.password:
        if user.status == "banned":
            raise HTTPException(status_code=403, detail="ACCOUNT_BANNED")
        return {"status": "success", "user": {"username": user.username, "role": user.role, "balance": user.balance, "pos": user.pos_reviews, "xmr_address": user.xmr_address, "avatar": user.avatar, "status": user.status}}
    raise HTTPException(status_code=401, detail="Invalid credentials")

# --- ROUTES : DATA FETCHING ---

@app.get("/api/categories")
def get_categories(db: Session = Depends(get_db)):
    return db.query(Category).all()

@app.get("/api/messages")
def get_messages(db: Session = Depends(get_db)):
    return db.query(Message).order_by(Message.timestamp.desc()).limit(50).all()

@app.get("/api/listings")
async def get_listings(db: Session = Depends(get_db)):
    items = db.query(Listing).all()
    rate = await get_xmr_usd_rate()
    return {"items": items, "rate": rate}

# --- ROUTES : TRANSACTIONS & LISTINGS ---

@app.post("/api/listings")
def create_listing(data: ListingCreate, db: Session = Depends(get_db)):
    new_id = str(int(datetime.utcnow().timestamp()))
    new_item = Listing(id=new_id, title=data.title, price_xmr=data.price_xmr, category=data.category, vendor=data.vendor, description=data.description, image=data.image)
    db.add(new_item)
    db.commit()
    return {"status": "success"}

@app.post("/api/listings/purchase")
def purchase_item(data: PurchaseRequest, db: Session = Depends(get_db)):
    listing = db.query(Listing).filter(Listing.id == data.listing_id).first()
    buyer = db.query(User).filter(User.username == data.buyer_username).first()
    if not listing or not buyer:
        raise HTTPException(status_code=404, detail="DATA_NOT_FOUND")
    vendor = db.query(User).filter(User.username == listing.vendor).first()
    admin = db.query(User).filter(User.role == "admin").first()
    if buyer.balance < listing.price_xmr:
        raise HTTPException(status_code=400, detail="INSUFFICIENT_XMR")
    tax = listing.price_xmr * 0.08
    vendor_cut = listing.price_xmr - tax
    buyer.balance -= listing.price_xmr
    vendor.balance += vendor_cut
    if admin: admin.balance += tax
    db.commit()
    return {"status": "TRANSMISSION_COMPLETE", "tax": tax}

# --- ROUTES : ADMIN CONTROL ---

@app.get("/api/admin/users")
def get_admin_users(db: Session = Depends(get_db)):
    return db.query(User).all()

@app.post("/api/admin/create-user")
def admin_create_user(data: UserAction, db: Session = Depends(get_db)):
    # Vérification si l'utilisateur existe déjà
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="User already exists")
    
    new_user = User(
        username=data.username,
        password=data.password or "123", # "123" par défaut
        role=data.role,
        balance=0.0,
        status="active",
        xmr_address=generate_real_xmr_address()
    )
    db.add(new_user)
    db.commit()
    return {"status": "success", "message": f"Identity {data.username} created as {data.role}"}

@app.get("/api/admin/disputes")
def get_admin_disputes(db: Session = Depends(get_db)):
    return [] # Placeholder

@app.get("/api/admin/seller-requests")
def get_seller_requests(db: Session = Depends(get_db)):
    return [] # Placeholder

@app.post("/api/admin/add-category")
def admin_add_category(data: dict, db: Session = Depends(get_db)):
    new_cat = Category(name=data['name'], parent=data.get('parent'))
    db.add(new_cat)
    db.commit()
    return {"status": "success"}

@app.post("/api/admin/ban-user")
def ban_user(data: UserAction, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if user:
        user.status = "banned"
        db.commit()
        return {"status": "success"}
    raise HTTPException(status_code=404)

@app.post("/api/admin/unban-user")
def unban_user(data: UserAction, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if user:
        user.status = "active"
        db.commit()
        return {"status": "success"}
    raise HTTPException(status_code=404)

# --- USER UPDATES ---

@app.post("/api/user/update-avatar")
def update_avatar(data: UserAction, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if user:
        user.avatar = data.avatar
        db.commit()
        return {"status": "success"}
    raise HTTPException(status_code=404)

# --- SETUP & SEEDING ---
@app.get("/api/setup-demo")
def setup_demo(db: Session = Depends(get_db)):
    db.query(User).delete()
    db.query(Category).delete()
    db.query(Listing).delete()
    # Création de l'admin par défaut
    admin_user = User(username="snnk69", password="123", role="admin", balance=100.0, xmr_address=generate_real_xmr_address())
    db.add(admin_user)
    
    cats = [
        Category(name="Drugs", parent=None),
        Category(name="Cannabis", parent="Drugs"),
        Category(name="Services", parent=None)
    ]
    db.add_all(cats)
    db.commit()
    return {"status": "DATABASE_REBUILT_SUCCESSFULLY"}