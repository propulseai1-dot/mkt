-- Extension pour la génération d'UUID (plus dur à deviner que des ID 1, 2, 3)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- TABLE UTILISATEURS
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    public_key_pgp TEXT NOT NULL, -- On stocke la clé PGP, pas de mot de passe
    role VARCHAR(20) DEFAULT 'user', -- user, vendor, admin
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABLE PRODUITS (LISTINGS)
CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor_id UUID REFERENCES users(id),
    title VARCHAR(100) NOT NULL,
    description TEXT,
    price_xmr DECIMAL(12, 6) NOT NULL,
    category VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- TABLE MESSAGES (CHIFFRÉS)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID REFERENCES users(id),
    receiver_id UUID REFERENCES users(id),
    encrypted_content TEXT NOT NULL, -- Le contenu est déjà chiffré côté client
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);