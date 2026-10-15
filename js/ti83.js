// TI-83 in the hero. The home screen does math, PRGM lists programs, and
// visitors can write their own small TI-BASIC programs. DAVID is archived
// (read-only), the way a TI marks a program you can run but not edit.
// Visitor programs are kept in localStorage, so they never leave the browser.

(() => {
  const calc = document.querySelector('.calc');
  if (!calc) return;
  const lcd = calc.querySelector('.lcd');
  const screen = lcd.querySelector('.lcd-screen');
  const input = lcd.querySelector('.lcd-in');
  const editBox = lcd.querySelector('.lcd-edit');
  const editHead = editBox.querySelector('.lcd-edit-head');
  const editor = editBox.querySelector('textarea');
  const say = calc.querySelector('.sr-only');

  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, calm ? 0 : ms));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';');

  const source = { html: screen.innerHTML, label: screen.getAttribute('aria-label') };

  // ---------- storage ----------

  const KEY = 'ti83-programs';
  const loadPrograms = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY)) || {};
      return Object.fromEntries(
        Object.entries(saved).filter(
          ([name, lines]) =>
            /^[A-Z][A-Z0-9]{0,7}$/.test(name) &&
            name !== 'DAVID' &&
            Array.isArray(lines) &&
            lines.every((l) => typeof l === 'string')
        )
      );
    } catch {
      return {};
    }
  };
  let programs = loadPrograms();
  const savePrograms = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(programs));
    } catch {
      // Private mode or storage blocked: programs last until the tab closes
    }
  };
  const ARCHIVED = 'DAVID';
  const programNames = () => [ARCHIVED, ...Object.keys(programs)].sort();

  // ---------- expressions ----------

  class TIError extends Error {
    constructor(msg, extra = {}) {
      super(msg);
      Object.assign(this, extra);
    }
  }

  const vars = {};
  let ans = 0;

  const tokenize = (src) => {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const rest = src.slice(i);
      let m;
      if (/^\s/.test(rest)) i++;
      else if ((m = rest.match(/^(\d+\.?\d*|\.\d+)/))) {
        if ((m[1].match(/\./g) || []).length > 1) throw new TIError('SYNTAX');
        out.push({ t: 'num', v: parseFloat(m[1]) });
        i += m[1].length;
      } else if (rest[0] === '"') {
        const end = src.indexOf('"', i + 1);
        out.push({ t: 'str', v: src.slice(i + 1, end < 0 ? undefined : end) });
        i = end < 0 ? src.length : end + 1;
      } else if ((m = rest.match(/^STR(\d)/i))) {
        out.push({ t: 'var', v: 'Str' + m[1] });
        i += 4;
      } else if ((m = rest.match(/^ANS/i))) {
        out.push({ t: 'ans' });
        i += 3;
      } else if (/^[A-Z]/i.test(rest)) {
        out.push({ t: 'var', v: rest[0].toUpperCase() });
        i++;
      } else if ((m = rest.match(/^(->|→|<=|>=|!=|<>|≤|≥|≠|[-+*/^()=<>,])/))) {
        const op = { '->': '→', '<=': '≤', '>=': '≥', '!=': '≠', '<>': '≠' }[m[1]] || m[1];
        out.push({ t: 'op', v: op });
        i += m[1].length;
      } else throw new TIError('SYNTAX');
    }
    return out;
  };

  const num = (v) => {
    if (typeof v !== 'number') throw new TIError('DATA TYPE');
    if (Number.isNaN(v)) throw new TIError('NONREAL ANS');
    if (!Number.isFinite(v)) throw new TIError('OVERFLOW');
    return v;
  };

  // Precedence, loosest first: store, comparison, + -, * / (and implied
  // multiplication like 2A), negation, ^. Like a TI, ^ chains left to right
  // and a missing closing parenthesis is fine.
  const evaluate = (src) => {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
    const startsValue = () =>
      peek() && (peek().t !== 'op' ? true : peek().v === '(');

    const primary = () => {
      const tok = toks[p++];
      if (!tok) throw new TIError('SYNTAX');
      if (tok.t === 'num' || tok.t === 'str') return tok.v;
      if (tok.t === 'ans') return ans;
      if (tok.t === 'var') {
        if (tok.v.startsWith('Str') && !(tok.v in vars)) throw new TIError('UNDEFINED');
        return vars[tok.v] ?? 0;
      }
      if (tok.v === '(') {
        const v = compare();
        if (isOp(')')) p++;
        else if (peek()) throw new TIError('SYNTAX');
        return v;
      }
      throw new TIError('SYNTAX');
    };
    const operand = () => (isOp('-') ? (p++, -num(operand())) : primary());
    const power = () => {
      let v = primary();
      while (isOp('^')) {
        p++;
        v = num(Math.pow(num(v), num(operand())));
      }
      return v;
    };
    const unary = () => (isOp('-') ? (p++, num(-num(unary()))) : power());
    const product = () => {
      let v = unary();
      for (;;) {
        if (isOp('*')) (p++, (v = num(num(v) * num(unary()))));
        else if (isOp('/')) {
          p++;
          const d = num(unary());
          if (d === 0) throw new TIError('DIVIDE BY 0');
          v = num(num(v) / d);
        } else if (startsValue()) v = num(num(v) * num(unary()));
        else return v;
      }
    };
    const sum = () => {
      let v = product();
      for (;;) {
        if (isOp('+')) {
          p++;
          const r = product();
          if (typeof v === 'string' && typeof r === 'string') v += r;
          else v = num(num(v) + num(r));
        } else if (isOp('-')) (p++, (v = num(num(v) - num(product()))));
        else return v;
      }
    };
    const compare = () => {
      let v = sum();
      while (peek() && peek().t === 'op' && '=≠<>≤≥'.includes(peek().v)) {
        const op = toks[p++].v;
        const r = sum();
        if (op === '=' || op === '≠') {
          if (typeof v !== typeof r) throw new TIError('DATA TYPE');
          v = (v === r) === (op === '=') ? 1 : 0;
        } else {
          const [a, b] = [num(v), num(r)];
          v = { '<': a < b, '>': a > b, '≤': a <= b, '≥': a >= b }[op] ? 1 : 0;
        }
      }
      return v;
    };

    if (!toks.length) throw new TIError('SYNTAX');
    let v = compare();
    if (isOp('→')) {
      p++;
      const target = toks[p++];
      if (!target || target.t !== 'var' || peek()) throw new TIError('SYNTAX');
      if (target.v.startsWith('Str') !== (typeof v === 'string')) throw new TIError('DATA TYPE');
      vars[target.v] = v;
    }
    if (peek()) throw new TIError('SYNTAX');
    return v;
  };

  const format = (v) => {
    if (typeof v === 'string') return v;
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e10 || a < 1e-3) {
      return v.toExponential(9).replace(/\.?0+e/, 'e').replace('e+', 'E').replace('e', 'E');
    }
    return String(Number(v.toPrecision(10)));
  };

  // ---------- screen ----------

  let state = 'source';
  let home = []; // { t, right, html }
  let entry = { prompt: '', show: true };
  let history = [];
  let historyAt = -1;
  let menu = { tab: 0, at: 0 };
  let error = null;
  let editing = null;
  let pendingInput = null;
  let breakRequested = false;

  const line = (t, right = false, html) => ({ t, right, html });
  const push = (l) => {
    home.push(l);
    if (home.length > 60) home = home.slice(-60);
  };

  const cursorHTML = () => {
    // A TI pastes programs as prgmNAME, lowercase prgm
    const v = input.value.replace(/^PRGM(?=[A-Z])/, 'prgm');
    const at = Math.min(input.selectionStart ?? v.length, v.length);
    const ch = v[at];
    return (
      esc(v.slice(0, at)) +
      (ch ? '<span class="on">' + esc(ch) + '</span>' + esc(v.slice(at + 1)) : '<span class="cur"></span>')
    );
  };

  const show = (rows, label) => {
    screen.innerHTML = rows.join('');
    screen.scrollTop = screen.scrollHeight;
    screen.setAttribute('aria-label', label || screen.innerText.trim() || 'Blank calculator screen');
  };
  const row = (inner, cls = '', attrs = '') =>
    '<div' + (cls ? ' class="' + cls + '"' : '') + attrs + '>' + inner + '</div>';

  const render = () => {
    editBox.hidden = state !== 'edit';
    screen.hidden = state === 'edit';
    if (state === 'source') {
      screen.innerHTML = source.html;
      screen.scrollTop = 0;
      screen.setAttribute('aria-label', source.label);
    } else if (state === 'home' || state === 'run' || state === 'input') {
      const rows = home.map((l) => row(l.html || esc(l.t), l.right ? 'r' : ''));
      if (state !== 'run' && entry.show) rows.push(row(esc(entry.prompt) + cursorHTML()));
      show(rows);
    } else if (state === 'menu') {
      const tabs = ['EXEC', 'EDIT', 'NEW'];
      const rows = [
        row(tabs.map((t, i) => '<span data-tab="' + i + '"' + (i === menu.tab ? ' class="inv"' : '') + '>' + t + '</span>').join(' ')),
      ];
      const items = menuItems();
      const top = Math.max(0, Math.min(menu.at - 5, items.length - 6));
      items.slice(top, top + 6).forEach((label, k) => {
        const i = top + k;
        const n = i < 9 ? String(i + 1) : i === 9 ? '0' : ' ';
        rows.push(row((i === menu.at ? '<span class="inv">' + n + ':</span>' : n + ':') + esc(label), 'hit', ' data-item="' + i + '"'));
      });
      if (!items.length) rows.push(row('(EMPTY)'));
      show(rows, tabs[menu.tab] + ' menu: ' + (items.length ? items.join(', ') : 'empty'));
    } else if (state === 'name') {
      show([row('PROGRAM'), row('Name=' + cursorHTML())], 'New program. Name: ' + input.value);
    } else if (state === 'error') {
      const opts = ['Quit'].concat(error.goto ? ['Goto'] : []);
      show(
        [row('ERR:' + esc(error.message))].concat(
          opts.map((o, i) =>
            row((i === error.at ? '<span class="inv">' + (i + 1) + '</span>' : i + 1) + ':' + o, 'hit', ' data-opt="' + i + '"')
          )
        ),
        'Error: ' + error.message + '. ' + opts.map((o, i) => i + 1 + ' ' + o).join(', ')
      );
    }
  };

  const announce = (text) => {
    say.textContent = text;
  };

  const focusInput = () => {
    if (state === 'edit') editor.focus({ preventScroll: true });
    else input.focus({ preventScroll: true });
  };

  const setEntry = (value, prompt = '') => {
    entry = { prompt, show: true };
    input.value = value;
    input.maxLength = state === 'name' ? 8 : 64;
    input.setSelectionRange(value.length, value.length);
  };

  const goHome = (value = '') => {
    state = 'home';
    editing = null;
    setEntry(value);
    render();
    focusInput();
  };

  const fail = (err, extra = {}) => {
    if (!(err instanceof TIError)) throw err;
    error = { message: err.message, at: 0, goto: err.goto || extra.goto || null };
    state = 'error';
    pendingInput = null;
    render();
    announce('Error: ' + err.message);
  };

  // ---------- programs ----------

  const splitArgs = (s) => {
    const out = [];
    let depth = 0, quoted = false, cur = '';
    for (const ch of s) {
      if (ch === '"') quoted = !quoted;
      if (!quoted && ch === '(') depth++;
      if (!quoted && ch === ')') depth--;
      if (ch === ',' && !quoted && depth <= 0) (out.push(cur), (cur = ''));
      else cur += ch;
    }
    out.push(cur);
    return out.map((a) => a.trim()).filter(Boolean);
  };

  const disp = async (v, slow) => {
    push(typeof v === 'string' ? line(v) : line(format(v), true));
    if (slow) {
      render();
      await wait(260);
      if (breakRequested) throw new TIError('BREAK');
    }
  };

  const ask = (prompt) =>
    new Promise((resolve, reject) => {
      if (breakRequested) return reject(new TIError('BREAK'));
      state = 'input';
      setEntry('', prompt);
      pendingInput = { resolve, reject };
      render();
      focusInput();
      announce(prompt.trim() + ' Type an answer and press Enter.');
    });

  // Read a value for Input/Prompt: strings are taken as typed, numbers are
  // evaluated, so 2+2 typed at a prompt stores 4.
  const readInto = async (prompt, name) => {
    const typed = await ask(prompt);
    push(line(prompt + typed));
    vars[name] = name.startsWith('Str') ? typed : num(evaluate(typed || '0'));
    state = 'run';
  };

  const runUser = async (name) => {
    const lines = programs[name].map((l) => l.replace(/^:/, '').trim());
    const labels = {};
    lines.forEach((l, i) => {
      const m = l.match(/^Lbl\s+(\w{1,2})$/i);
      if (m) labels[m[1].toUpperCase()] = i;
    });
    let steps = 0;
    for (let pc = 0; pc < lines.length; pc++) {
      const l = lines[pc];
      const gotoLine = { name, line: pc };
      try {
        if (++steps % 250 === 0) {
          render();
          await new Promise((r) => setTimeout(r));
        }
        if (breakRequested) throw new TIError('BREAK');
        let m;
        if (!l || /^Lbl\s/i.test(l)) continue;
        if (/^ClrHome$/i.test(l)) home = [];
        else if ((m = l.match(/^Disp\b(.*)$/i))) {
          for (const a of splitArgs(m[1])) await disp(evaluate(a));
        } else if ((m = l.match(/^Input\b(.*)$/i))) {
          const args = splitArgs(m[1]);
          const v = (args.pop() || '').toUpperCase().replace(/^STR/, 'Str');
          if (!/^([A-Z]|Str\d)$/.test(v)) throw new TIError('SYNTAX');
          const prompt = args.length ? String(evaluate(args[0])) : '?';
          await readInto(prompt, v);
        } else if ((m = l.match(/^Prompt\s+(.+)$/i))) {
          for (const a of splitArgs(m[1])) {
            const v = a.toUpperCase().replace(/^STR/, 'Str');
            if (!/^([A-Z]|Str\d)$/.test(v)) throw new TIError('SYNTAX');
            await readInto(v + '=?', v);
          }
        } else if ((m = l.match(/^Pause\b(.*)$/i))) {
          if (m[1].trim()) await disp(evaluate(m[1]));
          await ask('');
          state = 'run';
        } else if (/^(Stop|Return)$/i.test(l)) break;
        else if ((m = l.match(/^If\s+(.+)$/i))) {
          const v = evaluate(m[1]);
          if (typeof v !== 'number') throw new TIError('DATA TYPE');
          if (!v) pc++;
        } else if ((m = l.match(/^Goto\s+(\w{1,2})$/i))) {
          const to = labels[m[1].toUpperCase()];
          if (to === undefined) throw new TIError('LABEL');
          pc = to;
        } else ans = evaluate(l);
      } catch (err) {
        if (err instanceof TIError && !err.goto) err.goto = { edit: gotoLine };
        throw err;
      }
    }
  };

  const yes = /^(Y|YES|YEAH|YEP|SURE|OK|OKAY|ABSOLUTELY|OF COURSE)\b/;
  const no = /^(N|NO|NOPE|NAH|NEVER)\b/;

  const runDavid = async (resume) => {
    if (!resume) {
      home = [];
      await disp('HELLO, WORLD', true);
      await disp('SINCE AGE 12', true);
    }
    const a = (await ask('HIRE? ')).trim();
    vars.Str1 = a;
    if (no.test(a)) throw new TIError('WRONG ANSWER', { goto: { resume: true } });
    push(line('HIRE? ' + a));
    state = 'run';
    if (yes.test(a)) {
      push(line('GREAT CHOICE.'));
      push(line('', false, '<a href="mailto:contact@davidrivera.me">contact@davidrivera.me</a>'));
    } else if (a) {
      push(line("I'LL TAKE THAT"));
      push(line('AS A MAYBE.'));
    }
  };

  const run = async (name, resume) => {
    state = 'run';
    breakRequested = false;
    render();
    try {
      if (name === ARCHIVED) await runDavid(resume);
      else if (programs[name]) await runUser(name);
      else throw new TIError('UNDEFINED');
      push(line('Done', true));
      announce(home.slice(-4).map((l) => l.t || 'contact@davidrivera.me').join('. '));
      goHome();
    } catch (err) {
      fail(err);
      if (error && error.goto && error.goto.resume) error.goto.program = name;
    }
  };

  // ---------- home screen ----------

  const enterHome = () => {
    let v = input.value.trim();
    if (!v) {
      if (!history.length) return;
      v = history[history.length - 1];
    }
    const typed = v;
    history = history.filter((h) => h !== v).concat(v).slice(-20);
    historyAt = -1;
    const prg = v.match(/^PRGM\s*([A-Z][A-Z0-9]{0,7})$/i);
    push(line(prg ? 'prgm' + prg[1].toUpperCase() : v));
    if (prg) return run(prg[1].toUpperCase());
    // An entry starting with an operator works on the last answer, like a TI
    if (/^([+*/^]|->|→)/.test(v)) v = 'Ans' + v;
    try {
      ans = evaluate(v);
      push(line(format(ans), typeof ans === 'number'));
      announce(v + ' equals ' + format(ans));
      setEntry('');
      render();
    } catch (err) {
      home.pop();
      fail(err, { goto: { entry: typed } });
    }
  };

  // ---------- PRGM menu ----------

  const menuItems = () =>
    menu.tab === 2 ? ['Create New'] : programNames().map((n) => (n === ARCHIVED ? '*' + n : n));

  const openMenu = () => {
    if (state === 'edit') closeEditor();
    state = 'menu';
    menu = { tab: 0, at: 0 };
    setEntry('');
    render();
    focusInput();
    announce('Program menu, ' + ['EXEC', 'EDIT', 'NEW'][menu.tab] + ' tab. ' + menuItems().join(', '));
  };

  const pickMenu = (i) => {
    const names = programNames();
    if (menu.tab === 0) return goHome('PRGM' + names[i]);
    if (menu.tab === 1) {
      if (names[i] === ARCHIVED) return fail(new TIError('ARCHIVED'));
      return openEditor(names[i]);
    }
    state = 'name';
    setEntry('');
    render();
    announce('New program. Type a name up to 8 letters and numbers, then press Enter.');
  };

  const createProgram = () => {
    const name = input.value;
    if (!name) return;
    if (name === ARCHIVED) return fail(new TIError('ARCHIVED'));
    if (!programs[name]) {
      programs[name] = [];
      savePrograms();
    }
    openEditor(name);
  };

  // ---------- editor ----------

  const openEditor = (name, atLine) => {
    state = 'edit';
    editing = name;
    editHead.textContent = 'PROGRAM:' + name;
    const lines = programs[name].length ? programs[name] : [''];
    editor.value = lines.map((l) => ':' + l).join('\n');
    render();
    editor.focus({ preventScroll: true });
    let at = editor.value.length;
    if (atLine !== undefined) {
      const before = editor.value.split('\n').slice(0, atLine + 1).join('\n');
      at = before.length;
    }
    editor.setSelectionRange(at, at);
    announce('Editing program ' + name + '. Changes save as you type. Press Escape to quit.');
  };

  const saveEditor = () => {
    if (!editing) return;
    programs[editing] = editor.value.split('\n').map((l) => l.replace(/^:/, ''));
    savePrograms();
  };

  // Leaving an empty program deletes it, so stray names don't pile up
  const closeEditor = () => {
    saveEditor();
    if (editing && programs[editing].every((l) => !l.trim())) {
      delete programs[editing];
      savePrograms();
    }
    editing = null;
  };

  editor.addEventListener('input', saveEditor);
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
      goHome();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      editor.setRangeText('\n:', editor.selectionStart, editor.selectionEnd, 'end');
      saveEditor();
    }
  });

  // ---------- keys ----------

  const clearKey = () => {
    if (state === 'run' || state === 'input') {
      breakRequested = true;
      if (pendingInput) {
        const { reject } = pendingInput;
        pendingInput = null;
        reject(new TIError('BREAK'));
      }
    } else if (state === 'edit') {
      closeEditor();
      goHome();
    } else if (state === 'home' && input.value) {
      setEntry('');
      render();
    } else {
      home = [];
      goHome();
    }
  };

  const key = (k) => {
    if (state === 'source') {
      if (k === 'Enter') {
        history.push('PRGM' + ARCHIVED);
        run(ARCHIVED);
      }
    } else if (state === 'home') {
      if (k === 'Enter') enterHome();
      else if (k === 'ArrowUp' || k === 'ArrowDown') {
        if (!history.length) return;
        if (historyAt < 0) historyAt = history.length;
        historyAt = Math.max(0, Math.min(history.length, historyAt + (k === 'ArrowUp' ? -1 : 1)));
        setEntry(history[historyAt] || '');
        render();
      }
    } else if (state === 'input') {
      if (k === 'Enter' && pendingInput) {
        const { resolve } = pendingInput;
        pendingInput = null;
        resolve(input.value);
      }
    } else if (state === 'name') {
      if (k === 'Enter') createProgram();
      else if (k === 'Escape') goHome();
    } else if (state === 'menu') {
      const n = menuItems().length;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        menu.tab = (menu.tab + (k === 'ArrowLeft' ? 2 : 1)) % 3;
        menu.at = 0;
      } else if (k === 'ArrowUp') menu.at = (menu.at - 1 + n) % n;
      else if (k === 'ArrowDown') menu.at = (menu.at + 1) % n;
      else if (k === 'Enter') return pickMenu(menu.at);
      else if (k === 'Escape') return goHome();
      else if (/^\d$/.test(k)) {
        const i = k === '0' ? 9 : +k - 1;
        if (i < n) return pickMenu(i);
        return;
      } else return;
      render();
      announce(menuItems()[menu.at] || 'empty');
    } else if (state === 'error') {
      const n = error.goto ? 2 : 1;
      if (k === 'ArrowUp' || k === 'ArrowDown') error.at = (error.at + 1) % n;
      else if (k === '1' || k === '2' || k === 'Enter') {
        const pick = k === 'Enter' ? error.at : +k - 1;
        if (pick >= n) return;
        const g = error.goto;
        error = null;
        if (pick === 0) return goHome();
        if (g.edit) return openEditor(g.edit.name, g.edit.line);
        if (g.resume) return run(g.program, true);
        return goHome(g.entry || '');
      } else if (k === 'Escape') return goHome();
      else return;
      render();
    }
  };

  input.addEventListener('keydown', (e) => {
    const typing = state === 'home' || state === 'input' || state === 'name';
    if (e.key === 'Escape' && (state === 'run' || state === 'input')) return clearKey();
    if (['Enter', 'Escape'].includes(e.key) || (!typing && e.key.length === 1) || (/^Arrow/.test(e.key) && !(typing && /Left|Right/.test(e.key)))) {
      // Typing on the program listing drops you onto the home screen
      if (state === 'source' && /^[\d.(-]$/.test(e.key)) {
        goHome();
        return;
      }
      e.preventDefault();
      key(e.key);
    } else if (typing) requestAnimationFrame(render);
  });
  input.addEventListener('input', () => {
    if (state === 'home' || state === 'input' || state === 'name') {
      const at = input.selectionStart;
      const allowed = state === 'name' ? /[^A-Z0-9]/g : /[^A-Z0-9 .+\-*/^()=<>!,"→?']/g;
      let v = input.value.toUpperCase().replace(allowed, '');
      if (state === 'name') v = v.replace(/^\d+/, '').slice(0, 8);
      input.value = v;
      input.setSelectionRange(Math.min(at, v.length), Math.min(at, v.length));
      render();
    } else {
      // Some mobile keyboards skip keydown, so read the key from the value
      const k = input.value.slice(-1);
      input.value = '';
      if (k) key(k);
    }
  });

  lcd.addEventListener('click', (e) => {
    if (e.target.closest('a') || state === 'edit') return;
    focusInput();
    const tab = e.target.closest('[data-tab]');
    const item = e.target.closest('[data-item]');
    const opt = e.target.closest('[data-opt]');
    if (state === 'source') key('Enter');
    else if (state === 'menu' && tab) {
      menu = { tab: +tab.dataset.tab, at: 0 };
      render();
    } else if (state === 'menu' && item) pickMenu(+item.dataset.item);
    else if (state === 'error' && opt) key(String(+opt.dataset.opt + 1));
  });

  calc.querySelector('.keys').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.key === 'prgm') {
      if (state !== 'run' && state !== 'input') openMenu();
    } else clearKey();
    focusInput();
  });
})();
