import { animate } from 'motion';
import { createElement, LayoutDashboard, CalendarDays, ListChecks, ShoppingBasket, Utensils, Wallet, StickyNote, MessagesSquare, PawPrint, UsersRound, Grid2X2, ListTodo, Activity, MapPin, CookingPot, ContactRound, Cake, Clock3, ChartPie, Images, FolderOpen, Plus, Moon, Sun, LogOut, ChevronRight, ChevronLeft } from 'lucide';

const icons = {
 today:LayoutDashboard, event:CalendarDays, task:ListChecks, shopping:ShoppingBasket,
 meal:Utensils, expense:Wallet, note:StickyNote, message:MessagesSquare, pet:PawPrint,
 family:UsersRound, more:Grid2X2, lists:ListTodo, activity:Activity, location:MapPin,
 recipe:CookingPot, contact:ContactRound, birthday:Cake, schedule:Clock3, budget:ChartPie,
 photo:Images, document:FolderOpen, plus:Plus, moon:Moon, sun:Sun, signout:LogOut,
 chevron:ChevronRight, calendar:CalendarDays, routine:Clock3, left:ChevronLeft, right:ChevronRight,
};

export function icon(name, className = '') {
  const definition = icons[name];
  if (!definition) return '';
  const element = createElement(definition);
  element.setAttribute('aria-hidden','true');
  element.setAttribute('class','ui-icon '+className);
  element.setAttribute('stroke-width','1.8');
  return element.outerHTML;
}

export function animateEntry(target, distance = 10) {
  if (!target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  animate(target, { opacity:[0,1], y:[distance,0] }, { duration:0.22, ease:'easeOut' });
}

const themeKey = 'casa-theme';
const darkPreference = matchMedia('(prefers-color-scheme: dark)');

export function currentTheme() {
  const saved=localStorage.getItem(themeKey);
  return saved === 'dark' || saved === 'light' ? saved : darkPreference.matches ? 'dark' : 'light';
}

function applyTheme() {
  const theme=currentTheme();
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',theme==='dark'?'#181526':'#f6f5fb');
}

export function toggleTheme() {
  localStorage.setItem(themeKey,currentTheme()==='dark'?'light':'dark');
  applyTheme();
}

applyTheme();
darkPreference.addEventListener('change',applyTheme);
