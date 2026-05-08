# 🔒 SYSTÈME D'ESCROW SILKGENESIS

## 📋 COMMENT ÇA FONCTIONNE

Le système d'escrow est **DÉJÀ IMPLÉMENTÉ** dans le backend. Voici le flux complet:

---

## 🔄 FLUX COMPLET D'UNE TRANSACTION

### **ÉTAPE 1: ACHETEUR DÉPOSE DES FONDS**
```
Acheteur → Clique "DEPOSIT" → Envoie XMR à son adresse
         → Balance mis à jour: 1.5 XMR
```

### **ÉTAPE 2: ACHETEUR ACHÈTE UN PRODUIT**
```javascript
// Frontend envoie:
POST /api/orders
{
  "listing_id": "LST_abc123",
  "buyer": "alice"
}

// Backend fait automatiquement:
1. Vérifie balance acheteur >= prix produit
2. DÉDUIT les fonds du wallet acheteur
3. PLACE les fonds en ESCROW
4. Crée la commande avec status "escrow"
5. Ouvre un chat entre acheteur/vendeur

// Résultat:
- Alice balance: 1.5 - 0.3 = 1.2 XMR
- Escrow: 0.3 XMR (bloqué)
- Status: "escrow"
```

### **ÉTAPE 3: VENDEUR EXPÉDIE**
```javascript
POST /api/orders/{order_id}/mark-shipped

// Backend:
- Change status: "escrow" → "shipped"
- Vendeur peut envoyer message de tracking dans le chat
```

### **ÉTAPE 4: ACHETEUR CONFIRME RÉCEPTION**
```javascript
POST /api/orders/{order_id}/complete

// Backend fait automatiquement:
1. Prend les fonds de l'escrow (0.3 XMR)
2. TRANSFÈRE au wallet du vendeur
3. Change status: "shipped" → "completed"

// Résultat:
- Escrow: 0 XMR
- Vendeur balance: +0.3 XMR
- Transaction terminée!
```

---

## 💻 ENDPOINTS API DISPONIBLES

### **1. Créer une commande (Acheter)**
```bash
POST http://127.0.0.1:5000/api/orders
Content-Type: application/json

{
  "listing_id": "LST_abc123",
  "buyer": "alice"
}

# Réponse:
{
  "status": "success",
  "order_id": "ORD_def456",
  "message": "0.3 XMR transferred to escrow",
  "amount_xmr": 0.3
}
```

### **2. Voir mes commandes**
```bash
GET http://127.0.0.1:5000/api/orders/alice

# Réponse:
{
  "orders": [
    {
      "id": "ORD_def456",
      "listing_id": "LST_abc123",
      "buyer": "alice",
      "vendor": "bob",
      "amount_xmr": 0.3,
      "status": "escrow",
      "escrow_balance": 0.3,
      "created_at": "2026-04-19T16:00:00"
    }
  ]
}
```

### **3. Vendeur marque comme expédié**
```bash
POST http://127.0.0.1:5000/api/orders/ORD_def456/mark-shipped

# Réponse:
{
  "status": "success"
}
```

### **4. Acheteur confirme réception (Libère l'escrow)**
```bash
POST http://127.0.0.1:5000/api/orders/ORD_def456/complete

# Réponse:
{
  "status": "success"
}
```

### **5. Chat de la commande**
```bash
# Voir les messages
GET http://127.0.0.1:5000/api/chat/ORD_def456

# Envoyer un message
POST http://127.0.0.1:5000/api/chat
{
  "order_id": "ORD_def456",
  "sender": "alice",
  "message": "Quand allez-vous expédier?"
}
```

---

## 🎨 INTERFACE FRONTEND À AJOUTER

Pour rendre le système visible, il faut ajouter une page "Orders" dans App.js:

### **Page Orders - Composant React**

```javascript
function OrdersPage({ user, orders, onMarkShipped, onComplete }) {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-black text-white">My Orders</h2>
      
      {orders.map(order => (
        <div key={order.id} className="bg-[#111] border border-amber-900/20 p-6 rounded-2xl">
          {/* HEADER */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-xl text-amber-500">Order #{order.id}</h3>
              <p className="text-sm text-gray-500">
                {user.username === order.buyer ? `Vendor: ${order.vendor}` : `Buyer: ${order.buyer}`}
              </p>
            </div>
            <div className={`px-4 py-2 rounded-xl text-xs font-black ${
              order.status === 'escrow' ? 'bg-yellow-900/20 text-yellow-500' :
              order.status === 'shipped' ? 'bg-blue-900/20 text-blue-500' :
              'bg-green-900/20 text-green-500'
            }`}>
              {order.status.toUpperCase()}
            </div>
          </div>

          {/* ESCROW INFO */}
          <div className="bg-black/40 p-4 rounded-xl mb-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">Escrow Amount:</span>
              <span className="text-amber-500 font-black">{order.amount_xmr} XMR</span>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-gray-500 text-sm">Status:</span>
              <span className="text-white text-sm">
                {order.status === 'escrow' && '🔒 Funds locked in escrow'}
                {order.status === 'shipped' && '📦 Package shipped, awaiting confirmation'}
                {order.status === 'completed' && '✅ Funds released to vendor'}
              </span>
            </div>
          </div>

          {/* ACTIONS */}
          <div className="flex gap-4">
            {/* VENDEUR: Marquer comme expédié */}
            {user.username === order.vendor && order.status === 'escrow' && (
              <button 
                onClick={() => onMarkShipped(order.id)}
                className="flex-1 bg-blue-600 text-black py-3 rounded-xl font-black hover:bg-blue-500"
              >
                📦 Mark as Shipped
              </button>
            )}

            {/* ACHETEUR: Confirmer réception */}
            {user.username === order.buyer && order.status === 'shipped' && (
              <button 
                onClick={() => onComplete(order.id)}
                className="flex-1 bg-green-600 text-black py-3 rounded-xl font-black hover:bg-green-500"
              >
                ✅ Confirm Receipt (Release Escrow)
              </button>
            )}

            {/* CHAT */}
            <button className="px-6 py-3 border border-amber-900/40 text-amber-500 rounded-xl hover:bg-amber-900/10">
              💬 Open Chat
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

### **Ajouter dans App.js:**

```javascript
// Dans le state
const [orders, setOrders] = useState([]);

// Dans loadData()
const ordersRes = await fetch(`http://127.0.0.1:5000/api/orders/${user.username}`);
if (ordersRes.ok) {
  const ordersData = await ordersRes.json();
  setOrders(ordersData.orders || []);
}

// Fonctions d'action
const handleMarkShipped = async (orderId) => {
  await fetch(`http://127.0.0.1:5000/api/orders/${orderId}/mark-shipped`, {
    method: 'POST'
  });
  loadData();
};

const handleCompleteOrder = async (orderId) => {
  await fetch(`http://127.0.0.1:5000/api/orders/${orderId}/complete`, {
    method: 'POST'
  });
  loadData();
  alert("ESCROW RELEASED! Funds transferred to vendor.");
};

// Dans le menu sidebar
<li onClick={() => setActiveTab('orders')}>
  📦 Orders
</li>

// Dans le main content
{activeTab === 'orders' && (
  <OrdersPage 
    user={user}
    orders={orders}
    onMarkShipped={handleMarkShipped}
    onComplete={handleCompleteOrder}
  />
)}
```

---

## 🔐 SÉCURITÉ DE L'ESCROW

### **Protection Acheteur:**
- ✅ Fonds bloqués jusqu'à confirmation de réception
- ✅ Peut ouvrir un litige si problème
- ✅ Chat avec vendeur pour suivi

### **Protection Vendeur:**
- ✅ Fonds garantis une fois expédié
- ✅ Libération automatique après confirmation
- ✅ Peut prouver l'expédition via chat

### **Protection Plateforme:**
- ✅ Fonds en escrow = sécurisés
- ✅ Pas de chargeback possible
- ✅ Système de litiges pour résolution

---

## 📊 STATUTS DES COMMANDES

| Status | Description | Actions Disponibles |
|--------|-------------|---------------------|
| `escrow` | Fonds bloqués, en attente d'expédition | Vendeur: Mark Shipped |
| `shipped` | Colis expédié, en attente de confirmation | Acheteur: Confirm Receipt |
| `completed` | Transaction terminée, fonds libérés | Aucune |
| `disputed` | Litige ouvert | Admin: Resolve |

---

## 🎯 EXEMPLE COMPLET

```javascript
// 1. Alice dépose 1 XMR
POST /api/wallet/deposit { username: "alice", amount: 1.0 }
// Alice balance: 1.0 XMR

// 2. Alice achète un produit à 0.3 XMR
POST /api/orders { listing_id: "LST_123", buyer: "alice" }
// Alice balance: 0.7 XMR
// Escrow: 0.3 XMR
// Status: "escrow"

// 3. Bob (vendeur) expédie
POST /api/orders/ORD_456/mark-shipped
// Status: "shipped"

// 4. Alice confirme réception
POST /api/orders/ORD_456/complete
// Escrow: 0 XMR
// Bob balance: +0.3 XMR
// Status: "completed"
```

---

## ✅ RÉSUMÉ

**LE SYSTÈME D'ESCROW EST DÉJÀ FONCTIONNEL!**

Il suffit d'ajouter l'interface frontend pour:
1. Voir les commandes
2. Marquer comme expédié (vendeur)
3. Confirmer réception (acheteur)
4. Ouvrir le chat

**Tous les endpoints backend sont prêts et testés!** 🚀
