import React from 'react';
import './AlphaBanner.css';

const AlphaBanner = ({ slotsUsed = 5 }) => {
  const totalSlots = 20;
  const slotsLeft = totalSlots - slotsUsed;
  const progress = Math.max(0, Math.min(100, (slotsUsed / totalSlots) * 100));

  return (
    <div className="alpha-banner">
      <div className="alpha-content">
        <div className="alpha-left">
          <span className="status-tag">FOUNDER PROGRAM</span>
          <p className="main-text">
            <span className="brand-name">SilkGenesis</span> offers
            <strong> 0% marketplace fees for 60 days</strong> to the first 20 verified founder vendors.
          </p>
        </div>
        <div className="alpha-right">
          <span className="slots-tag">
            Claimed <span className="count">{slotsUsed}</span> / {totalSlots}
          </span>
          <span className="slots-left">{slotsLeft} spots left</span>
        </div>
      </div>
      <div className="alpha-progress-track" aria-hidden="true">
        <div className="alpha-progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};

export default AlphaBanner;