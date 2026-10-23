import React, {useRef, useState} from 'react';
import {panelText} from './member-reserve-art.jsx';

// Keep existing controller controls mounted. A regular panel also avoids
// WebKit's hidden native select renderer inside a reopened details element.
export function MemberSettings({children, icon}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef(null);
  return <div className="member-settings" data-open={open ? '' : undefined}
    onKeyDown={event => {
      if (open && event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    }}>
    <button ref={toggle} type="button" className="icon-button member-settings-toggle"
      aria-label={panelText('settings')} aria-expanded={open}
      aria-controls="member-settings-panel" onClick={() => setOpen(value => !value)}>
      {icon}<span className="member-sr-only">{panelText('settings')}</span>
    </button>
    <div id="member-settings-panel" className="member-settings-panel" hidden={!open}>
      {children}
    </div>
  </div>;
}
