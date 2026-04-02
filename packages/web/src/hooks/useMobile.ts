import { useState, useEffect } from 'react';

interface MobileState {
  isMobile: boolean;
  isTablet: boolean;
  isTouch: boolean;
  isPortrait: boolean;
}

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

export function useMobile(): MobileState {
  const [state, setState] = useState<MobileState>(() => ({
    isMobile: window.innerWidth < MOBILE_BREAKPOINT,
    isTablet: window.innerWidth >= MOBILE_BREAKPOINT && window.innerWidth < TABLET_BREAKPOINT,
    isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    isPortrait: window.innerHeight > window.innerWidth,
  }));

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      setState({
        isMobile: width < MOBILE_BREAKPOINT,
        isTablet: width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT,
        isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
        isPortrait: height > width,
      });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return state;
}

// Hook for viewport height (handles mobile keyboard)
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);

  useEffect(() => {
    const updateHeight = () => {
      // Use visual viewport if available (handles mobile keyboard)
      const vh = window.visualViewport?.height || window.innerHeight;
      setHeight(vh);
    };

    window.addEventListener('resize', updateHeight);
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateHeight);
    }

    return () => {
      window.removeEventListener('resize', updateHeight);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateHeight);
      }
    };
  }, []);

  return height;
}
