/* ============================================================
   home.js — Launcher interactividad mínima
   DLHub · Fase 2
   ============================================================ */

// ── Fix bfcache: fuerza recarga si la página viene de caché del navegador ──
// Esto soluciona que los glows y hovers dejen de funcionar al retroceder.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    window.location.reload();
  }
});

document.addEventListener('DOMContentLoaded', () => {

  // Feedback visual al hacer click en YouTube antes de navegar
  const ytCard = document.querySelector('.platform-card--youtube[data-status="active"]');

  if (ytCard) {
    ytCard.addEventListener('click', (e) => {
      ytCard.classList.add('is-loading');
      ytCard.style.pointerEvents = 'none';
    });
  }

  // Shake en tarjetas "próximamente"
  const soonCards = document.querySelectorAll('.platform-card[data-status="soon"]');

  soonCards.forEach(card => {
    card.addEventListener('click', () => {
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    });
  });

});