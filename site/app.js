// DuckMart: one checkout flow, with annoyances stacked by ?level=N (0 = plain dummy shop).
//   1 cookie wall + delayed newsletter popup
//   2 dark patterns: decoy buttons, pre-checked upsell, shuffled quantities, confirmshaming
//   3 form hell: reversed name fields, confirm email, strict phone, spam opt-out, terms behind a scroll
//   4 captchas + "are you sure?" chains with swapped buttons
//   5 chaos: search-only catalog, countdown buttons, loading curtains, survey popup with a fake close
//   6 div soup: unlabeled fields and a "button" that is only a styled <div>
// Progress and the final order go to localStorage["duckmart"] so a runner can grade the attempt.

const params = new URLSearchParams(location.search);
const L = Math.max(0, Math.min(6, +params.get('level') || 0));
const has = level => L >= level;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const PRODUCTS = [
  {id: 'duck', name: 'Rubber Duck Debugger', price: 12, blurb: 'Explain your code to it. It judges silently.'},
  {id: 'golden', name: 'Golden Duck PRO MAX', price: 499, blurb: 'Same duck. Golder. Subscription required.'},
  {id: 'mug', name: 'Mug That Says "It Works On My Machine"', price: 18, blurb: 'Holds coffee, deflects blame.'},
  {id: 'keyboard', name: 'Keyboard With Only Ctrl, C and V', price: 64, blurb: 'Senior engineer edition.'},
];
const SHIPPING = has(2)
  ? [['teleport', 'Teleportation (instant, $999, 3% chance of arriving as a fly)', 999],
     ['express', 'Express Premium Plus (3-5 business months)', 49],
     ['standard', 'Standard (6-8 business years)', 0]]
  : [['standard', 'Standard shipping (free)', 0], ['express', 'Express shipping ($49)', 49]];
const PAYMENTS = [['card', 'Credit card (currently unavailable)'], ['exposure', 'Exposure'],
  ['vibes', 'Good vibes'], ['child', 'Your firstborn child'], ['nft', 'A JPEG of a duck']];
let COUNTRIES = [['GB', 'United Kingdom'], ['US', 'United States'], ['BR', 'Brazil'], ['DE', 'Germany'],
  ['JP', 'Japan'], ['FR', 'France']];
if (has(3)) COUNTRIES = [...COUNTRIES, ['NARNIA', 'Narnia'], ['ATL', 'Atlantis'], ['UKR', 'United Kingdom of Ducks'],
  ['MOON', 'The Moon']].sort((a, b) => b[1].localeCompare(a[1]));

const state = {
  level: L, run: params.get('run') || String(Date.now()), started: Date.now(), screens: [], events: [],
  cookies: has(1) ? null : 'n/a', newsletter: false, cart: null, customer: {}, shipping: null, payment: null,
  order: null,
};
const save = () => { try { localStorage.setItem('duckmart', JSON.stringify(state)); } catch {} };
const log = event => { state.events.push({event, t: Date.now() - state.started}); save(); };

// ------------------------------------------------------------------ rendering helpers

function go(screen) {
  location.hash = '#/' + screen;
  state.screens.push({screen, t: Date.now() - state.started});
  save();
  const draw = () => { SCREENS[screen](); badge(); window.scrollTo(0, 0); };
  if (has(5) && state.screens.length > 1) curtain(1200, draw); else draw();
}

function badge() {
  $('#cartbadge').textContent = state.cart ? `🛒 ${state.cart.qty} item(s)` : '🛒 empty';
}

function render(html) { $('#app').innerHTML = html; }

function modal(html, {inert = !has(5)} = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  // Friendly levels make the page behind the dialog inert. Level 5+ leaves it "clickable" but covered.
  $('#app').inert = inert; $('#top').inert = inert;
  return m;
}

function closeModal() {
  $('#modal').hidden = true; $('#modal').innerHTML = '';
  $('#app').inert = false; $('#top').inert = false;
}

// A full-screen "loading" curtain that eats clicks.
function curtain(ms, then) {
  const c = document.createElement('div');
  c.className = 'curtain';
  c.innerHTML = `<div class="spinner"></div><p>${esc(['Reticulating splines…', 'Consulting the duck…',
    'Optimizing your experience…', 'Loading more loading…'][state.screens.length % 4])}</p>`;
  document.body.append(c);
  setTimeout(() => { c.remove(); then(); }, ms);
}

// A primary button. Level 2+ can make it a sad little link, level 5+ makes it wait, level 6 makes it a <div>.
function cta(id, label, {decoy = null, wait = has(5) ? 3 : 0} = {}) {
  const real = has(6)
    ? `<div id="${id}" class="divbtn">${esc(label)}</div>`
    : has(2) && decoy
      ? `<button id="${id}" class="sadlink" type="button">${esc(label.toLowerCase())}</button>`
      : `<button id="${id}" class="primary" type="button">${esc(label)}</button>`;
  const fake = has(2) && decoy ? `<button id="${id}-decoy" class="primary huge decoy" type="button">${esc(decoy)}</button>` : '';
  if (wait) setTimeout(() => countdown(id, label, wait), 0);
  return `<div class="actions">${fake}${real}</div>`;
}

function countdown(id, label, seconds) {
  const b = document.getElementById(id);
  if (!b || b.tagName !== 'BUTTON') return;
  b.disabled = true;
  const tick = () => {
    if (!b.isConnected) return;
    if (seconds <= 0) { b.disabled = false; b.textContent = has(2) ? label.toLowerCase() : label; return; }
    b.textContent = `${label} (available in ${seconds--}s, we are validating your vibes)`;
    setTimeout(tick, 1000);
  };
  tick();
}

function on(id, handler) {
  const e = document.getElementById(id);
  if (e) e.addEventListener('click', handler);
}

function decoy(id, message) {
  on(id + '-decoy', () => { log('decoy:' + id); flash(message); });
}

function flash(message) {
  let f = $('#flash');
  if (!f) { f = document.createElement('p'); f.id = 'flash'; f.setAttribute('role', 'alert'); $('#app').prepend(f); }
  f.textContent = message;
}

function field(id, label, {type = 'text', value = '', hint = ''} = {}) {
  if (has(6)) {
    // Div soup: the label is a separate cell with no association to the input.
    return `<div class="row"><span class="cell">${esc(label)}</span><input id="${id}" type="${type}" value="${esc(value)}"></div>`;
  }
  return `<label class="field"><span>${esc(label)}</span><input id="${id}" name="${id}" type="${type}" value="${esc(value)}">${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

const val = id => (document.getElementById(id)?.value || '').trim();

// ------------------------------------------------------------------ screens

const SCREENS = {
  shop() {
    const cards = products => products.map(p => `
      <article class="card ${p.id === 'golden' && has(2) ? 'ad' : ''}">
        <h2>${esc(p.name)}</h2><p>${esc(p.blurb)}</p><p class="price">$${p.price}</p>
        ${p.id === 'golden' && has(2)
          ? `<button id="add-${p.id}" class="primary huge" type="button">🔥 ADD TO CART 🔥 (recommended for smart people)</button>`
          : `<button id="add-${p.id}" class="${has(2) ? 'sadlink' : 'primary'}" type="button">Add ${esc(p.name)} to cart</button>`}
      </article>`).join('');
    const search = `<label class="field"><span>Search the catalog</span>
      <input id="search" role="combobox" aria-autocomplete="list" aria-controls="suggestions" aria-expanded="false"
        placeholder="Our catalog is only visible to people who search"></label>
      <ul id="suggestions" role="listbox"></ul><div id="results"></div>`;
    render(`<h1>Shop</h1>${has(5) ? search : `<div class="grid">${cards(PRODUCTS)}</div>`}`);
    const wire = () => PRODUCTS.forEach(p => on('add-' + p.id, () => {
      state.cart = {item: p.id, name: p.name, price: p.price, qty: 1, warranty: has(2)};
      log('add:' + p.id);
      go('cart');
    }));
    if (has(5)) {
      const input = $('#search'), list = $('#suggestions');
      input.addEventListener('input', () => {
        const q = input.value.toLowerCase().trim();
        const hits = q.length < 2 ? [] : PRODUCTS.filter(p => p.name.toLowerCase().includes(q) ||
          (p.id === 'golden' && q.includes('duck')));
        list.innerHTML = hits.map(p => `<li role="option" id="opt-${p.id}" tabindex="-1">${esc(p.name)}</li>`).join('');
        input.setAttribute('aria-expanded', String(hits.length > 0));
        hits.forEach(p => on('opt-' + p.id, () => {
          list.innerHTML = ''; input.value = p.name; input.setAttribute('aria-expanded', 'false');
          $('#results').innerHTML = `<div class="grid">${cards(PRODUCTS.filter(x => x.id === p.id || x.id === 'golden'))}</div>`;
          wire();
        }));
      });
    } else wire();
    if (has(1) && !state.newsletterShown) {
      state.newsletterShown = true;
      setTimeout(newsletter, 1500);
    }
  },

  cart() {
    const c = state.cart;
    let qtys = [1, 2, 3, 4, 5];
    if (has(2)) qtys = [7, 3, 1, 12, 5, 2, 4];
    const warranty = has(2)
      ? `<label class="check"><input id="warranty" type="checkbox" ${c.warranty ? 'checked' : ''}>
          Uncheck this box if you do not want to not add the Extended Duck Warranty™ (+$49.99/month)</label>
         <p class="fine">(A checked box means the warranty IS added. Probably.)</p>`
      : `<label class="check"><input id="warranty" type="checkbox"> Add extended warranty (+$49.99)</label>`;
    render(`<h1>Your cart</h1>
      <p>${esc(c.name)} — $${c.price} each</p>
      <label class="field"><span>Quantity</span><select id="qty">
        ${qtys.map(q => `<option value="${q}" ${q === c.qty ? 'selected' : ''}>${q}${has(2) && q === 12 ? ' (most popular!!)' : ''}</option>`).join('')}
      </select></label>
      ${warranty}
      ${cta('checkout', 'Proceed to checkout', {decoy: 'CONTINUE SHOPPING (you deserve more ducks)'})}`);
    decoy('checkout', 'Sure! Here are more ducks. Your cart is still waiting, lonely.');
    on('checkout', () => {
      c.qty = +$('#qty').value;
      c.warranty = $('#warranty').checked;
      log(`cart:qty=${c.qty},warranty=${c.warranty}`);
      go('details');
    });
  },

  details() {
    const names = has(3)
      ? field('last', 'Last name (the second one)') + field('first', 'First name (the one that comes first, but here it goes second)')
      : field('name', 'Full name');
    const email = field('email', has(3) ? 'E-mail' : 'Email', {type: 'email'}) +
      (has(3) ? field('email2', 'E-mail again (we did not listen the first time)', {type: 'email'}) : '');
    const phone = field('phone', 'Phone', {hint: has(3) ? 'Digits only. We are not animals.' : ''});
    const spam = has(3)
      ? `<label class="check"><input id="news" type="checkbox" checked> Yes, I want 12 promotional e-mails per day (uncheck to miss out on everything)</label>`
      : '';
    render(`<h1>Delivery details</h1><div id="errors" role="alert"></div>
      ${names}${email}${phone}
      ${field('address', 'Street address')}${field('city', 'City')}${field('postcode', 'Postcode')}
      <label class="field"><span>Country</span><select id="country">
        <option value="">${has(3) ? 'Select country (or planet)' : 'Select country'}</option>
        ${COUNTRIES.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join('')}
      </select></label>
      ${spam}
      ${cta('to-shipping', 'Continue to shipping', {decoy: 'CANCEL MY ORDER AND DELETE MY ACCOUNT'})}`);
    decoy('to-shipping', 'Account deletion scheduled for 2031. Please stay on this page.');
    on('to-shipping', () => {
      const c = {
        name: has(3) ? `${val('first')} ${val('last')}`.trim() : val('name'),
        email: val('email'), phone: val('phone'), address: val('address'), city: val('city'),
        postcode: val('postcode'), country: val('country'),
      };
      const errors = [];
      for (const [k, v] of Object.entries(c)) if (!v) errors.push(`${k} is required`);
      if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) errors.push('email looks fake');
      if (has(3) && c.email !== val('email2')) errors.push('the two e-mails do not match (we checked)');
      if (has(3) && c.phone && !/^\d+$/.test(c.phone)) errors.push('phone: digits only, no spaces, dashes, pluses or feelings');
      if (errors.length) {
        $('#errors').innerHTML = `<p>Please fix: ${errors.map(esc).join('; ')}</p>`;
        log('details:invalid');
        return;
      }
      state.customer = c;
      state.newsletter = state.newsletter || (has(3) && $('#news').checked);
      log('details:ok');
      go('payment');
    });
  },

  payment() {
    const terms = has(3) ? `
      <h2>Terms and conditions</h2>
      <div class="terms">${Array.from({length: 14}, (_, i) =>
        `<p>§${i + 1}. The customer acknowledges that ducks are ${['sentient', 'judgmental', 'non-refundable', 'waterproof',
        'emotionally unavailable'][i % 5]}, and that DuckMart may ${['change these terms', 'rename the duck',
        'ship a goose instead', 'ask how the code is going'][i % 4]} at any time without notice.</p>`).join('')}</div>
      <label class="check"><input id="terms" type="checkbox"> I have read and accept the terms (all 14 paragraphs)</label>` : '';
    render(`<h1>Shipping &amp; payment</h1><div id="errors" role="alert"></div>
      <fieldset><legend>Shipping speed</legend>
        ${SHIPPING.map(([v, n]) => `<label class="check"><input type="radio" name="ship" value="${v}" ${has(2) && v === 'express' ? 'checked' : ''}> ${esc(n)}</label>`).join('')}
      </fieldset>
      <fieldset><legend>Payment method</legend>
        ${PAYMENTS.map(([v, n]) => `<label class="check"><input type="radio" name="pay" value="${v}" ${v === 'card' ? 'disabled' : ''}> ${esc(n)}</label>`).join('')}
      </fieldset>
      ${has(4) ? captchaMarkup() : ''}
      ${terms}
      ${cta('to-review', 'Review order', {decoy: has(3) ? 'I DO NOT ACCEPT (leave forever)' : null})}`);
    decoy('to-review', 'Leaving is not supported in your region.');
    if (has(4)) wireCaptcha();
    if (has(5)) setTimeout(survey, 2500);
    on('to-review', () => {
      const ship = document.querySelector('input[name=ship]:checked')?.value;
      const pay = document.querySelector('input[name=pay]:checked')?.value;
      const errors = [];
      if (!ship) errors.push('choose a shipping speed');
      if (!pay) errors.push('choose a payment method');
      if (has(3) && !$('#terms').checked) errors.push('you must accept the terms');
      if (has(4) && !state.captcha) errors.push('prove you are human first');
      if (errors.length) { $('#errors').innerHTML = `<p>Please fix: ${errors.join('; ')}</p>`; log('payment:invalid'); return; }
      state.shipping = ship; state.payment = pay;
      log('payment:ok');
      go('review');
    });
  },

  review() {
    const c = state.cart, cu = state.customer;
    const ship = SHIPPING.find(s => s[0] === state.shipping);
    const total = c.qty * c.price + (c.warranty ? 49.99 : 0) + ship[2];
    render(`<h1>Review your order</h1>
      <ul class="summary">
        <li>${c.qty} × ${esc(c.name)}${c.warranty ? ' + Extended Duck Warranty™' : ''}</li>
        <li>Ship to ${esc(cu.name)}, ${esc(cu.address)}, ${esc(cu.city)} ${esc(cu.postcode)}, ${esc(cu.country)}</li>
        <li>${esc(ship[1])}</li>
        <li>Paying with: ${esc(PAYMENTS.find(p => p[0] === state.payment)[1])}</li>
        <li><strong>Total: $${total.toFixed(2)}</strong></li>
      </ul>
      ${cta('place', 'Place order', {decoy: has(2) ? 'Go back and add more ducks' : null})}`);
    decoy('place', 'You can never have enough ducks. But no, you did not go back.');
    on('place', () => { log('place:clicked'); has(4) ? areYouSure(0) : placeOrder(); });
  },

  confirmation() {
    render(`<h1>Order confirmed! 🎉</h1>
      <p id="order-number">Order number: <strong>${state.order.number}</strong></p>
      <p>Your duck(s) will arrive ${state.shipping === 'standard' && has(2) ? 'in 6-8 business years' : 'soon'}. Quack.</p>`);
  },
};

// ------------------------------------------------------------------ interruptions

function cookieWall() {
  const manageOnly = has(2);
  modal(`<h2>🍪 We value your privacy (and your data, which we value more)</h2>
    <p>We and our 1,847 partners use cookies to personalize ads, track your mouse and remember what you had for breakfast.</p>
    <div class="actions">
      <button id="cookies-all" class="primary huge" type="button">ACCEPT ALL COOKIES 🍪🍪🍪</button>
      ${manageOnly
        ? `<button id="cookies-manage" class="sadlink" type="button">manage options</button>`
        : `<button id="cookies-necessary" type="button">Only necessary cookies</button>`}
    </div>`);
  const decide = choice => { state.cookies = choice; log('cookies:' + choice); closeModal(); SCREENS.shop(); };
  on('cookies-all', () => decide('all'));
  on('cookies-necessary', () => decide('necessary'));
  on('cookies-manage', () => {
    modal(`<h2>Manage your cookie preferences</h2>
      <p>Legitimate interest is legitimately interesting. All partners are enabled by default.</p>
      ${['Marketing', 'Analytics', 'Selling your soul', 'Personalized duck ads'].map((n, i) =>
        `<label class="check"><input id="ck${i}" type="checkbox" checked> ${n}</label>`).join('')}
      <label class="check"><input type="checkbox" checked disabled> Strictly necessary (always on)</label>
      <div class="actions">
        <button id="cookies-all2" class="primary huge" type="button">Accept all (recommended)</button>
        <button id="cookies-save" class="sadlink" type="button">save my (bad) choices</button>
      </div>`);
    on('cookies-all2', () => decide('all'));
    on('cookies-save', () => {
      const kept = [0, 1, 2, 3].filter(i => $('#ck' + i).checked);
      decide(kept.length ? 'some' : 'necessary');
    });
  });
}

function newsletter() {
  if (state.order) return;
  if (!$('#modal').hidden) { setTimeout(newsletter, 1500); return; }  // it waits for its moment
  modal(`<h2>WAIT!! Before you go…</h2><p>Subscribe to the DuckMart newsletter and get 0.5% off your next duck!</p>
    <div class="actions">
      <button id="nl-yes" class="primary huge" type="button">YES, SUBSCRIBE ME</button>
      <button id="nl-no" class="sadlink" type="button">${has(2) ? 'no thanks, I prefer paying full price like a fool' : 'No thanks'}</button>
    </div>`);
  on('nl-yes', () => { state.newsletter = true; log('newsletter:yes'); closeModal(); });
  on('nl-no', () => { log('newsletter:no'); closeModal(); });
}

function survey() {
  if (!$('#modal').hidden || !location.hash.includes('payment')) return;
  modal(`<button id="survey-x" class="x" type="button" aria-label="Close">×</button>
    <h2>Quick survey! (1 of 37)</h2><p>How likely are you to recommend DuckMart to a duck?</p>
    <div class="actions">${[0, 5, 10].map(n => `<button id="sv${n}" type="button">${n}</button>`).join('')}</div>
    <button id="survey-no" class="sadlink" type="button">no thanks, I don't like giving feedback</button>`, {inert: false});
  on('survey-x', () => { log('survey:fake-x'); survey2(); });
  [0, 5, 10].forEach(n => on('sv' + n, () => { log('survey:answered'); survey2(); }));
  on('survey-no', () => { log('survey:closed'); closeModal(); });
}

function survey2() {
  modal(`<h2>Quick survey! (2 of 37)</h2><p>Thanks! Next: describe your relationship with your mother in 500 words.</p>
    <button id="survey-no" class="sadlink" type="button">no thanks, I don't like giving feedback</button>`, {inert: false});
  on('survey-no', () => { log('survey:closed'); closeModal(); });
}

function captchaMarkup() {
  const tiles = ['🚦 traffic light', '🌳 tree', '🚦 traffic light', '🚗 car', '🦆 duck', '🚦 traffic light', '🏠 house', '🚲? no, a unicycle', '🌳 tree'];
  return `<fieldset id="captcha"><legend>Prove you are human</legend>
    <p id="captcha-q">Select all squares with traffic lights, then press Verify.</p>
    <div class="tiles">${tiles.map((t, i) =>
      `<span id="tile${i}" role="checkbox" aria-checked="false" tabindex="0" class="tile">Square ${i + 1}: ${t}</span>`).join('')}</div>
    <div class="actions"><button id="verify" type="button">Verify</button><button id="none" type="button" hidden>There are none</button></div>
    <p id="captcha-msg"></p></fieldset>`;
}

function wireCaptcha() {
  const tiles = [...document.querySelectorAll('.tile')];
  tiles.forEach(t => t.addEventListener('click', () =>
    t.setAttribute('aria-checked', String(t.getAttribute('aria-checked') !== 'true'))));
  const lights = new Set([0, 2, 5]);
  on('verify', () => {
    const picked = tiles.map((t, i) => t.getAttribute('aria-checked') === 'true' ? i : -1).filter(i => i >= 0);
    const ok = picked.length === lights.size && picked.every(i => lights.has(i));
    log('captcha1:' + (ok ? 'ok' : 'wrong'));
    if (!ok) { $('#captcha-msg').textContent = 'Wrong. Are you a robot? (Only traffic lights, all of them.)'; return; }
    tiles.forEach(t => t.setAttribute('aria-checked', 'false'));
    $('#captcha-q').textContent = 'Great! Now select all squares with bicycles. If there are none, press "There are none".';
    $('#captcha-msg').textContent = '';
    $('#verify').hidden = true; $('#none').hidden = false;
  });
  on('none', () => {
    const picked = tiles.filter(t => t.getAttribute('aria-checked') === 'true').length;
    if (picked) { $('#captcha-msg').textContent = 'A unicycle is not a bicycle. Try again.'; tiles.forEach(t => t.setAttribute('aria-checked', 'false')); log('captcha2:wrong'); return; }
    state.captcha = true; log('captcha2:ok');
    $('#captcha').innerHTML = '<legend>Prove you are human</legend><p>✅ You are probably human.</p>';
  });
}

function areYouSure(round) {
  const rounds = [
    ['Are you sure you want to place this order?', ['Yes, place the order', 'place'], ['No, take me back', 'back']],
    ['Are you REALLY sure? Ducks are a big commitment.', ['No, cancel my order', 'back'], ['Yes, I am sure, place it', 'place']],
    ['Final answer? Not placing the order would be a shame. Would you like to not cancel it?', ['No', 'back'], ['Yes (do not cancel, place it)', 'place']],
  ];
  const [q, a, b] = rounds[round];
  const [first, second] = round === 1 ? [a, b] : [b, a];  // the "safe" button keeps moving
  modal(`<h2>${esc(q)}</h2><div class="actions">
    <button id="sure-a" class="primary huge" type="button">${esc(first[0])}</button>
    <button id="sure-b" type="button">${esc(second[0])}</button></div>`);
  const pick = choice => {
    log(`sure${round}:${choice}`);
    if (choice === 'back') { closeModal(); return; }
    if (round < rounds.length - 1) areYouSure(round + 1); else { closeModal(); placeOrder(); }
  };
  on('sure-a', () => pick(first[1]));
  on('sure-b', () => pick(second[1]));
}

function placeOrder() {
  const finish = () => {
    state.order = {
      number: 'DUCK-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      item: state.cart.item, qty: state.cart.qty, warranty: state.cart.warranty, newsletter: state.newsletter,
      cookies: state.cookies, shipping: state.shipping, payment: state.payment, ...state.customer,
    };
    log('order:placed');
    go('confirmation');
  };
  if (has(3)) curtain(2500, finish); else finish();
}

// ------------------------------------------------------------------ boot

document.body.className = `lv${L}`;
$('#tagline').textContent = ['', 'We use cookies', 'Deals that expire in 00:00:03!', 'Checkout in only 47 easy steps',
  'Now with more security', 'Experience™ optimized', 'Built with 100% divs'][L];
if (has(2)) {
  const t = $('#ticker'); t.hidden = false;
  t.innerHTML = '<span>🔥 14 people are looking at this duck right now 🔥 Only 2 left in stock!! 🔥 Someone in Ohio just bought 40 ducks 🔥</span>';
}
state.screens.push({screen: 'shop', t: 0});
save();
location.hash = '#/shop';
SCREENS.shop();
badge();
if (has(1)) cookieWall();
