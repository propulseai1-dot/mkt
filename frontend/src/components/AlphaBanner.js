import React from 'react';
import './AlphaBanner.css';

const AlphaBanner = ({ slotsUsed = 5 }) => {
  const totalSlots = 20;
  const slotsLeft = totalSlots - slotsUsed;

  return (
    <div className="alpha-banner">
      <div className="alpha-content">
        <span className="status-tag">[ PHASE ALPHA ]</span>
        <p className="main-text">
          <span className="brand-name">SilkGenesis</span> launch:
          <strong> 0% fees for 2 months</strong> for the first 20 verified vendors.
        </p>
        <span className="slots-tag">
          Already registered: <span className="count">{slotsUsed}</span> vendors
        </span>
      </div>
    </div>
  );
};

export default AlphaBanner;