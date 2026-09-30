(() => {
  const strip = document.querySelector('.announcement-strip');
  if (!strip) return;
  const pause = strip.querySelector('.announcement-pause');
  pause.addEventListener('click', () => {
    const paused = strip.classList.toggle('is-paused');
    pause.setAttribute('aria-pressed', String(paused));
    pause.setAttribute('aria-label', paused ? 'Resume scrolling information' : 'Pause scrolling information');
    pause.textContent = paused ? '▷' : 'Ⅱ';
  });
})();
