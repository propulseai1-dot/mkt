# 🎯 PLAN: Système de Chat et Pages Produits

## 📋 OBJECTIFS

1. **Page Produit Détaillée** - Chaque produit a sa propre page
2. **Chat Général** - Buyer peut contacter Vendor AVANT d'acheter
3. **Chat Escrow** - Discussion séparée liée à une transaction spécifique
4. **Navigation** - Pas de "Buy Now" direct, il faut voir la page produit d'abord

---

## 🏗️ ARCHITECTURE

### **1. BACKEND (market_server.py)**

#### **Nouveaux endpoints:**

```python
# CHAT GÉNÉRAL (buyer-vendor)
GET  /api/chat/general/{buyer}/{vendor}  # Récupérer messages
POST /api/chat/general                    # Envoyer message
     Body: {buyer, vendor, sender, message}

# CHAT ESCROW (lié à une commande)
GET  /api/chat/order/{order_id}          # Récupérer messages (existe déjà)
POST /api/chat/order                      # Envoyer message
     Body: {order_id, sender, message}
```

#### **Structure de données:**

```python
# Chat général: {buyer_vendor: [messages]}
general_chat_db = {}  # "alice_DarkPharmacy": [{...}, {...}]

# Chat escrow: {order_id: [messages]}
chat_db = {}  # "ORD_abc123": [{...}, {...}]
```

---

### **2. FRONTEND (App.js)**

#### **Nouveaux composants:**

```javascript
// 1. PAGE PRODUIT DÉTAILLÉE
function ProductDetailPage({ product, user, onBuy, onContactVendor }) {
  return (
    <div>
      <h1>{product.title}</h1>
      <img src={product.image} />
      <p>{product.description}</p>
      <p>Price: {product.price_xmr} XMR</p>
      <button onClick={onContactVendor}>Contact Vendor</button>
      <button onClick={onBuy}>Buy Now</button>
    </div>
  );
}

// 2. CHAT GÉNÉRAL (buyer-vendor)
function GeneralChatModal({ isOpen, onClose, buyer, vendor }) {
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');
  
  // Charger messages
  useEffect(() => {
    fetch(`/api/chat/general/${buyer}/${vendor}`)
      .then(res => res.json())
      .then(data => setMessages(data.messages));
  }, [buyer, vendor]);
  
  // Envoyer message
  const sendMessage = () => {
    fetch('/api/chat/general', {
      method: 'POST',
      body: JSON.stringify({buyer, vendor, sender: user.username, message: newMsg})
    });
  };
  
  return <ChatUI messages={messages} onSend={sendMessage} />;
}

// 3. CHAT ESCROW (dans OrdersPage)
function OrderChatModal({ isOpen, onClose, orderId, user }) {
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');
  
  // Charger messages
  useEffect(() => {
    fetch(`/api/chat/order/${orderId}`)
      .then(res => res.json())
      .then(data => setMessages(data.messages));
  }, [orderId]);
  
  // Envoyer message
  const sendMessage = () => {
    fetch('/api/chat/order', {
      method: 'POST',
      body: JSON.stringify({order_id: orderId, sender: user.username, message: newMsg})
    });
  };
  
  return <ChatUI messages={messages} onSend={sendMessage} />;
}
```

#### **Navigation:**

```javascript
// État pour la navigation
const [activeTab, setActiveTab] = useState('home');
const [selectedProduct, setSelectedProduct] = useState(null);

// Quand on clique sur un produit
<div onClick={() => {
  setSelectedProduct(product);
  setActiveTab('product-detail');
}}>
  {product.title}
</div>

// Affichage conditionnel
{activeTab === 'product-detail' && (
  <ProductDetailPage 
    product={selectedProduct}
    onBuy={() => handleBuyProduct(selectedProduct.id)}
    onContactVendor={() => {
      setShowGeneralChat(true);
      setChatVendor(selectedProduct.vendor);
    }}
  />
)}
```

---

## 🎨 UI/UX

### **Page Produit:**
```
┌─────────────────────────────────────┐
│  [← Back to Market]                 │
│                                     │
│  ┌─────────┐  Premium MDMA Crystal  │
│  │ IMAGE   │  Vendor: DarkPharmacy  │
│  │         │  Price: 0.45 XMR       │
│  └─────────┘  Rating: ⭐⭐⭐⭐⭐      │
│                                     │
│  Description:                       │
│  High quality MDMA crystal...       │
│                                     │
│  [Contact Vendor] [Buy Now]         │
└─────────────────────────────────────┘
```

### **Chat Général (buyer-vendor):**
```
┌─────────────────────────────────────┐
│  Chat with DarkPharmacy        [X]  │
├─────────────────────────────────────┤
│  DarkPharmacy: Hello!               │
│  You: Is this product available?    │
│  DarkPharmacy: Yes, in stock!       │
├─────────────────────────────────────┤
│  [Type message...] [Send]           │
└─────────────────────────────────────┘
```

### **Chat Escrow (dans Orders):**
```
┌─────────────────────────────────────┐
│  Order #ORD_abc123                  │
│  Status: SHIPPED                    │
│                                     │
│  [Mark Shipped] [Open Chat]         │
└─────────────────────────────────────┘

Quand on clique "Open Chat":
┌─────────────────────────────────────┐
│  Order Chat #ORD_abc123        [X]  │
├─────────────────────────────────────┤
│  Vendor: Package sent today!        │
│  You: Tracking number?              │
│  Vendor: TRACK123456                │
├─────────────────────────────────────┤
│  [Type message...] [Send]           │
└─────────────────────────────────────┘
```

---

## 📝 ÉTAPES D'IMPLÉMENTATION

### **Phase 1: Backend**
1. ✅ Ajouter `general_chat_db = {}`
2. ✅ Créer endpoint `GET /api/chat/general/{buyer}/{vendor}`
3. ✅ Créer endpoint `POST /api/chat/general`
4. ✅ Modifier endpoint `POST /api/chat` → `POST /api/chat/order`

### **Phase 2: Frontend - Page Produit**
1. ✅ Créer composant `ProductDetailPage`
2. ✅ Ajouter état `selectedProduct`
3. ✅ Modifier les cards produits pour naviguer vers la page détail
4. ✅ Retirer les boutons "Buy Now" directs

### **Phase 3: Frontend - Chat Général**
1. ✅ Créer composant `GeneralChatModal`
2. ✅ Ajouter bouton "Contact Vendor" sur page produit
3. ✅ Implémenter chargement/envoi de messages

### **Phase 4: Frontend - Chat Escrow**
1. ✅ Créer composant `OrderChatModal`
2. ✅ Ajouter bouton "Open Chat" dans OrdersPage
3. ✅ Séparer du chat général

### **Phase 5: Polish**
1. ✅ Styling des chats
2. ✅ Auto-refresh des messages
3. ✅ Notifications de nouveaux messages
4. ✅ Timestamps

---

## 🚀 VOULEZ-VOUS QUE JE COMMENCE L'IMPLÉMENTATION?

Je peux implémenter tout ça étape par étape. Ça va prendre plusieurs modifications de fichiers.

**Confirmez et je commence!** 🎯
