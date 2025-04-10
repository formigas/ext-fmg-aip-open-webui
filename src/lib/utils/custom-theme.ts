    export function loadCustomThemesFromLocalStorage() {
      try {
        if (typeof localStorage !== 'undefined') {
          const themesString = localStorage.getItem('customThemes');
          return themesString ? JSON.parse(themesString) : {};
        }
        return {};
      } catch (e) {
        console.error('Error parsing custom themes from localStorage:', e);
        return {};
      }
    }