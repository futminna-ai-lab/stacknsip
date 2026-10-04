(() => {
  'use strict';
  const money = value => '₦' + Number(value).toLocaleString('en-NG');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const categoryUrl = id => 'category.html?category=' + encodeURIComponent(id);
  const isCategoryPage = document.body.classList.contains('category-page');
  const sections = document.getElementById('menu-sections');
  const categoryTitle = document.getElementById('category-title');
  const input = document.getElementById('search');
  const form = document.getElementById('search-form');
  const noResults = document.getElementById('no-results');
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  function whatsappUrl(name, description = '') {
    return 'https://wa.me/2348161248972?text=' + encodeURIComponent('Hello Stack & Sip, I would like to order ' + name + (description ? ' (' + description + ')' : '') + '. Please confirm availability and pickup/delivery details.');
  }

  function productCard(category, record) {
    const {id, name, price, description, available, photo, photoAlt} = record;
    const url = 'product.html?item=' + encodeURIComponent(id);
    const picture = photo ? `<img src="${escape(photo)}" alt="${escape(photoAlt)}" loading="lazy">` : `<div class="offer-no-photo"><span>${escape(category.title)}</span></div>`;
    const action=available&&window.StackShop.hasOptions(record)?`<a class="add" href="${url}">Choose options</a>`:`<button class="add" type="button" data-add="${escape(id)}"${available?'':' disabled'}>${available?'Add To Cart':'Sold out'}</button>`;
    return `<article class="product offer-card" data-price="${Number(price)}" data-name="${escape(name)}" data-search="${escape((name + ' ' + description).toLowerCase())}"><a class="offer-image" href="${url}">${picture}</a><h4><a href="${url}">${escape(name)}</a></h4><span class="price">${money(price)}</span><div class="product-actions">${action}</div><span class="item-cart-status" data-cart-item="${escape(id)}" aria-live="polite"></span></article>`;
  }

  function categorySection(category) {
    const records = window.StackShop.records(category);
    const body = `<div class="product-grid">${records.map(record => productCard(category, record)).join('')}</div>`;
    return `<section class="menu-category" id="${escape(category.id)}" data-category="${escape(category.id)}"><div class="category-head"><h3>${escape(category.title)}</h3></div>${body}${category.note ? `<p class="free-adds">${escape(category.note)}</p>` : ''}</section>`;
  }

  function pricedCount(category) {
    return category.items.length + (category.extras || []).reduce((sum, group) => sum + group.items.length, 0) + (category.icecream ? 1 : 0);
  }

  function searchMenu() {
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    sections.querySelectorAll('.menu-category').forEach(section => {
      let matches = 0;
      section.querySelectorAll('[data-search]').forEach(card => {
        const match = !query || card.dataset.search.includes(query);
        card.hidden = !match;
        if (match) matches++;
      });
      section.hidden = matches === 0;
      section.querySelectorAll('.extra-box').forEach(group => {
        group.hidden = !Array.from(group.querySelectorAll('[data-search]')).some(card => !card.hidden);
      });
      shown += matches;
    });
    noResults.hidden = shown > 0;
  }

  if (form) form.addEventListener('submit', event => { event.preventDefault(); searchMenu(); });
  if (input) input.addEventListener('input', searchMenu);

  async function loadMenu() {
    try {
      const menu = await window.StackBackend.getMenu();
      if (!Array.isArray(menu.categories)) throw new Error('Invalid menu');
      const categories = menu.categories.filter(category => category.id !== 'extras');
      const optionsWarning = menu.optionsAvailable === false
        ? '<p class="menu-error menu-setup-warning">The menu is visible, but online ordering is unavailable until the database menu-option migrations are applied. Please contact the café to order.</p>'
        : '';
      const selectedId = new URLSearchParams(window.location.search).get('category');
      const selected = isCategoryPage ? categories.find(category => category.id === selectedId) : null;
      if (isCategoryPage && !selected) {
        categoryTitle.textContent = 'Category not found';
        document.getElementById('category-description').textContent = 'Choose a category from the full menu.';
        document.getElementById('breadcrumb-current').textContent = 'Not found';
        sections.innerHTML = '<p class="menu-error"><a href="./#categories">Browse all categories</a></p>';
        form.hidden = true;
        document.title = 'Category not found | Stack & Sip';
      } else {
        if (isCategoryPage) sections.innerHTML = optionsWarning + categorySection(selected);
        if (isCategoryPage) {
          document.title = selected.title + ' | Stack & Sip';
          categoryTitle.textContent = selected.title;
          document.getElementById('breadcrumb-current').textContent = selected.title;
          document.getElementById('category-description').textContent = selected.subtitle || 'Green Gardens, Wuse Zone 1, Abuja · Pickup & delivery';
          const count = pricedCount(selected);
          document.getElementById('category-status').textContent = `${count} ${count === 1 ? 'offer' : 'offers'}`;
          if (selected.photo) {
            const photo = document.getElementById('category-photo');
            photo.hidden = false;
            photo.innerHTML = `<img class="category-cover" src="${escape(selected.photo)}" alt="${escape(selected.photoAlt)}">${selected.photoSource ? `<a class="photo-source" href="${escape(selected.photoSource)}" target="_blank" rel="noopener noreferrer">From @stacknsip_</a>` : ''}`;
            document.getElementById('category-intro').classList.add('with-photo');
          }
        }
      }
      const filters = document.getElementById('filters');
      if (filters) filters.innerHTML = (isCategoryPage ? '<a class="filter" href="./#categories">All categories</a>' : '') + categories.map(category => `<a class="filter${selected?.id === category.id ? ' active' : ''}" href="${categoryUrl(category.id)}"${selected?.id === category.id ? ' aria-current="page"' : ''}>${escape(category.title)}</a>`).join('');
      window.StackShop.refresh();
      const tiles = document.getElementById('category-tiles');
      if (tiles) tiles.innerHTML = optionsWarning + categories.map(category => `<a class="category-tile${category.photo ? ' has-photo' : ''}" href="${categoryUrl(category.id)}">${category.photo ? `<img src="${escape(category.photo)}" alt="${escape(category.photoAlt)}" loading="lazy">` : ''}<span>${escape(category.title)}<small>${pricedCount(category)} ${pricedCount(category) === 1 ? 'offer' : 'offers'}</small></span></a>`).join('');
    } catch (error) {
      const errorTarget = sections || document.getElementById('category-tiles');
      errorTarget.innerHTML = '<p class="menu-error">The menu could not load. <a href="">Try again</a> or <a href="https://wa.me/2348161248972">contact us on WhatsApp</a>.</p>';
      if (form) form.hidden = true;
      if (categoryTitle) categoryTitle.textContent = 'Menu unavailable';
    }
  }
  const sort = document.getElementById('offer-sort');
  if (sort) sort.addEventListener('change', () => {
    const grid = sections.querySelector('.product-grid');
    if (!grid) return;
    const cards = Array.from(grid.children);
    cards.forEach((card, index) => { if (!card.dataset.menuOrder) card.dataset.menuOrder = String(index + 1); });
    cards.sort((a, b) => sort.value === 'price-asc' ? Number(a.dataset.price) - Number(b.dataset.price) : sort.value === 'price-desc' ? Number(b.dataset.price) - Number(a.dataset.price) : sort.value === 'name' ? a.dataset.name.localeCompare(b.dataset.name) : Number(a.dataset.menuOrder) - Number(b.dataset.menuOrder));
    cards.forEach(card => grid.appendChild(card));
  });
  window.addEventListener('stack-menu-updated',()=>loadMenu().catch(error=>console.error('Customer menu refresh failed:',error)));
  loadMenu();
})();
