import React, {useEffect, useRef, useState} from 'react';
import {language} from './locale.js';

const copy = {
  en: {settings: 'Workspace settings', pause: 'Pause motion', resume: 'Resume motion', art: 'Illustration of the token reserve mechanism'},
  fa: {settings: 'تنظیمات پنل', pause: 'توقف حرکت', resume: 'ادامهٔ حرکت', art: 'تصویر آموزشی سازوکار ذخیرهٔ توکن'},
  ar: {settings: 'إعدادات مساحة العمل', pause: 'إيقاف الحركة', resume: 'استئناف الحركة', art: 'رسم توضيحي لآلية احتياطي الرمز'},
  tr: {settings: 'Çalışma alanı ayarları', pause: 'Hareketi duraklat', resume: 'Hareketi sürdür', art: 'Token rezerv mekanizmasının gösterimi'},
  'zh-CN': {settings: '工作区设置', pause: '暂停动画', resume: '继续动画', art: '代币储备机制示意图'},
  ru: {settings: 'Настройки панели', pause: 'Остановить анимацию', resume: 'Продолжить анимацию', art: 'Иллюстрация механизма резерва токена'},
  es: {settings: 'Ajustes del panel', pause: 'Pausar movimiento', resume: 'Reanudar movimiento', art: 'Ilustración del mecanismo de reserva del token'},
};
export const panelText = key => (copy[language] || copy.en)[key];

export function MemberReserveArt() {
  const frame = useRef(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem('fti-panel-motion') === 'paused'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('fti-panel-motion', paused ? 'paused' : 'playing'); } catch {}
  }, [paused]);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {threshold: 0.05});
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  return <figure ref={frame} className={'member-reserve-figure' + (visible ? ' is-visible' : '') + (paused ? ' is-paused' : '')}>
    <div className="member-reserve-art" aria-hidden="true"/>
    <button type="button" className="member-art-toggle" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{panelText(paused ? 'resume' : 'pause')}</button>
    <figcaption className="member-sr-only">{panelText('art')}</figcaption>
  </figure>;
}
