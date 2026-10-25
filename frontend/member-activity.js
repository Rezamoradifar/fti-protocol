// Presentation and filtering for an already verified, bounded protocol-event
// snapshot. Fetching, cancellation and stale/error notices belong to the caller.
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO = '0x' + '0'.repeat(40);

const TITLES = {
  Registered: ['Membership registered', 'عضویت ثبت شد'],
  UnitsAdded: ['Membership units added', 'یونیت عضویت اضافه شد'],
  RewardAllocated: ['Hourly reward allocated', 'پاداش ساعتی تخصیص یافت'],
  Claimed: ['Rewards claimed', 'پاداش دریافت شد'],
  RewardBatchPaid: ['Reward batch paid', 'بستهٔ پاداش پرداخت شد'],
  BuilderMonthClosed: ['Builder month closed', 'ماه بیلدر بسته شد'],
  BuilderMonthCloseRequested: ['Monthly close requested', 'بستن ماه درخواست شد'],
  HourlyCapFlushed: ['Above-cap matches flushed', 'تعادل مازاد سقف فلش شد'],
  AutoExecuted: ['Auto-buy executed', 'خرید خودکار انجام شد'],
  AutoBuyPercentSet: ['Auto-buy percentage updated', 'درصد خرید خودکار تغییر کرد'],
  AutoPendingReleased: ['Pending auto-buy released', 'ماندهٔ خرید خودکار آزاد شد'],
  Bought: ['FTI purchased', 'توکن FTI خریداری شد'],
  Sold: ['FTI sold', 'توکن FTI فروخته شد'],
  Transfer: ['FTI transferred', 'توکن FTI منتقل شد'],
  Approval: ['Spending approval updated', 'مجوز خرج‌کردن تغییر کرد'],
  EpochClosed: ['Hourly epoch closed', 'دورهٔ ساعتی بسته شد'],
  PriceSupported: ['Reserve support applied', 'حمایت ذخیره انجام شد'],
  SupportInjected: ['Support funds injected', 'منابع حمایت تزریق شد'],
  CycleClosed: ['Token cycle closed', 'چرخهٔ توکن بسته شد'],
  EmergencyRedeemed: ['Emergency redemption recorded', 'بازپرداخت اضطراری ثبت شد'],
};

function category(name) {
  if (['Registered', 'UnitsAdded'].includes(name)) return ['Membership', 'عضویت', 'membership'];
  if (/^Auto/.test(name)) return ['Auto-buy', 'خرید خودکار', 'auto'];
  if (['RewardAllocated', 'Claimed', 'RewardBatchPaid', 'BuilderMonthClosed', 'BuilderMonthCloseRequested', 'HourlyCapFlushed'].includes(name)) {
    return ['Rewards', 'پاداش‌ها', 'rewards'];
  }
  if (['Bought', 'Sold', 'Transfer', 'Approval', 'EmergencyRedeemed'].includes(name)) return ['Token', 'توکن', 'token'];
  return ['Protocol', 'پروتکل', 'protocol'];
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) throw Error('Events are unavailable.');
  return rows.map(row => {
    if (!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120
        || !Array.isArray(row.args) || typeof row.hash !== 'string' || !HASH.test(row.hash)) {
      throw Error('Events are unavailable.');
    }
    const block = typeof row.block === 'string' && /^\d+$/.test(row.block) ? Number(row.block) : row.block;
    if (!Number.isSafeInteger(block) || block < 0) throw Error('Events are unavailable.');
    const args = row.args.map(arg => {
      if (!arg || typeof arg.name !== 'string' || arg.name.length > 120
          || !['string', 'number', 'bigint', 'boolean'].includes(typeof arg.value)
          || (typeof arg.value === 'number' && !Number.isSafeInteger(arg.value))) {
        throw Error('Events are unavailable.');
      }
      const value = String(arg.value);
      if (value.length > 4096) throw Error('Events are unavailable.');
      return {name: arg.name, value};
    });
    return {name: row.name, block, hash: row.hash, args};
  });
}

function explorerOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === '/' ? url.origin : null;
  } catch { return null; }
}

export function createMemberActivity({container, document, explorer, translate = value => value,
  getAddress = () => null, formatBlock = String}) {
  const t = translate, origin = explorerOrigin(explorer);
  let rows = [], loaded = false, scope = 'all', previousAddress = null;
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const address = () => {
    try {
      const value = getAddress();
      return typeof value === 'string' && ADDRESS.test(value) && value.toLowerCase() !== ZERO ? value.toLowerCase() : null;
    } catch { return null; }
  };

  const toolbar = make('div', undefined, 'member-activity-tools');
  const scopes = make('div', undefined, 'member-activity-scopes');
  scopes.setAttribute('role', 'group');
  scopes.setAttribute('aria-label', t('Event scope', 'محدودهٔ رویدادها'));
  const all = make('button', t('All protocol', 'کل پروتکل'), 'secondary');
  const mine = make('button', t('My wallet', 'ولت من'), 'secondary');
  for (const [button, value] of [[all, 'all'], [mine, 'wallet']]) {
    button.type = 'button';
    button.dataset.eventScope = value;
    button.onclick = () => { scope = value; paint(); };
    scopes.append(button);
  }
  const label = make('label', undefined, 'member-activity-search-label');
  label.append(make('span', t('Search recent events', 'جست‌وجو در رویدادهای اخیر')));
  const search = make('input', undefined, 'member-activity-search');
  search.type = 'search'; search.autocomplete = 'off'; search.spellcheck = false;
  search.placeholder = t('Event, wallet or transaction hash', 'رویداد، ولت یا هش تراکنش');
  search.setAttribute('aria-label', t('Search recent events', 'جست‌وجو در رویدادهای اخیر'));
  search.oninput = () => paint();
  label.append(search);
  const count = make('output', undefined, 'member-activity-count');
  count.setAttribute('aria-live', 'polite');
  const results = make('div', undefined, 'member-activity-results');
  toolbar.append(scopes, label, count);
  container.replaceChildren(toolbar, results);

  function eventCard(row) {
    const [en, fa, key] = category(row.name);
    const card = make('article', undefined, 'event member-event');
    card.dataset.eventCategory = key;
    const heading = make('div', undefined, 'member-event-heading');
    const title = make('div');
    const titleCopy = Object.hasOwn(TITLES, row.name) ? TITLES[row.name] : null;
    title.append(make('strong', titleCopy ? t(...titleCopy) : row.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')));
    title.append(make('small', row.name, 'member-event-name'));
    heading.append(title, make('span', t(en, fa), 'badge member-event-category'));
    const meta = make('p', t('Block', 'بلاک') + ' ' + formatBlock(row.block), 'member-event-meta');
    const hash = make('code', row.hash.slice(0, 10) + '…' + row.hash.slice(-6));
    hash.title = row.hash; hash.dir = 'ltr';
    meta.append(hash);
    const details = make('details', undefined, 'member-event-details');
    details.append(make('summary', t('Event details', 'جزئیات رویداد')));
    const args = make('dl', undefined, 'member-event-args');
    for (const arg of row.args) {
      const line = make('div');
      const value = make('dd', arg.value);
      value.dir = 'ltr';
      line.append(make('dt', arg.name || t('Value', 'مقدار')), value);
      args.append(line);
    }
    if (!row.args.length) args.append(make('p', t('No event arguments.', 'این رویداد دادهٔ ورودی ندارد.')));
    details.append(args);
    card.append(heading, meta, details);
    if (origin) {
      const link = make('a', t('View transaction ↗', 'مشاهده تراکنش ↗'), 'member-event-link');
      link.href = origin + '/tx/' + row.hash; link.target = '_blank'; link.rel = 'noopener noreferrer';
      card.append(link);
    }
    return card;
  }

  function paint() {
    const wallet = address();
    if (scope === 'wallet' && wallet !== previousAddress) search.value = '';
    previousAddress = wallet;
    mine.disabled = !wallet;
    mine.title = wallet ? '' : t('Connect a wallet to filter its recent events.', 'برای فیلتر رویدادهای اخیر، ولت خود را متصل کنید.');
    if (!wallet) scope = 'all';
    all.setAttribute('aria-pressed', String(scope === 'all'));
    mine.setAttribute('aria-pressed', String(scope === 'wallet'));
    const query = search.value.trim().toLowerCase();
    const filtered = rows.filter(row => {
      if (scope === 'wallet' && !row.args.some(arg => ADDRESS.test(arg.value) && arg.value.toLowerCase() === wallet)) return false;
      return !query || [row.name, row.hash, ...row.args.flatMap(arg => [arg.name, arg.value])]
        .some(value => value.toLowerCase().includes(query));
    });
    count.textContent = loaded
      ? t('Matching events', 'رویدادهای منطبق') + ': ' + filtered.length + ' / ' + rows.length
      : t('Recent protocol events', 'رویدادهای اخیر پروتکل');
    if (!loaded) {
      results.replaceChildren(make('p', t('Open activity or refresh events to load the recent protocol record.', 'برای خواندن رویدادهای اخیر، فعالیت‌ها را باز یا رویدادها را به‌روزرسانی کنید.'), 'member-activity-empty'));
    } else if (!filtered.length) {
      results.replaceChildren(make('p', rows.length
        ? t('No events match these filters in the loaded range. This is not a complete wallet history.', 'در بازهٔ خوانده‌شده رویدادی با این فیلترها وجود ندارد. این فهرست، تاریخچهٔ کامل ولت نیست.')
        : t('No protocol events were returned in this recent block range.', 'در این بازهٔ بلاک‌های اخیر، رویدادی برای پروتکل خوانده نشد.'), 'member-activity-empty'));
    } else {
      const fragment = document.createDocumentFragment();
      for (const row of filtered) fragment.append(eventCard(row));
      results.replaceChildren(fragment);
    }
  }

  paint();
  return {
    render(next) { const verified = normalizeRows(next); rows = verified; loaded = true; paint(); },
    refresh() { paint(); },
  };
}
