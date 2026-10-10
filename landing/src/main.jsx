import React from 'react';
import {createRoot} from 'react-dom/client';
import {initializeLanguage} from '../../frontend/locale.js';
import {PublicSite} from './public-site.jsx';
import './style.css';
import {InitialLanding} from './initial-landing.jsx';
initializeLanguage();
createRoot(document.getElementById('root')).render(['/token-site/','/whitepaper/','/roadmap/'].includes(location.pathname)?<PublicSite/>:<InitialLanding/>);
