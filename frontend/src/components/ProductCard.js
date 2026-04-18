import React from 'react';

export default function ProductCard({ name, price, vendor, onClick }) {
  return (
    <div onClick={onClick} className="bg-[#111111] border border-white/5 p-5 rounded-2xl hover:border-amber-900/50 transition-all cursor-pointer group">
      {/* ... tout ton code de la carte produit ici ... */}
    </div>
  );
}