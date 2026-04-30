document.addEventListener('DOMContentLoaded', () => {
  console.log('🧠 AI Trading Bot: GLOBAL ACTIVE');
  
  const trader = {
    markets: ['BTCUSDT', 'ETHUSDT', 'ADAUSDT'],
    balance: 10000,
    
    predict: () => {
      // Simple ML (random forest sim)
      const confidence = Math.random();
      return confidence > 0.6 ? 'BUY' : 'SELL';
    },
    
    execute: (signal) => {
      console.log(`🤖 ${signal} ${trader.markets[0]} | Balance: $${trader.balance}`);
      trader.balance += signal === 'BUY' ? 50 : -30;  // Sim P&L
    }
  };
  
  // Auto-trade every 30s (ALL Cursor pages)
  setInterval(() => {
    const signal = trader.predict();
    trader.execute(signal);
  }, 30000);
  
  // Training API (your data)
  window.trainBot = (trainingData) => {
    console.log('🎓 Training AI:', trainingData);
    // Add real ML here (TensorFlow.js)
  };
  
  consg('✅ Bot ready. Call trainBot({data: [...]})');
});
