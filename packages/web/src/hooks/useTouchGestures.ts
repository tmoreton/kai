import { useCallback, useRef, useState } from 'react';

interface SwipeInfo {
  direction: 'left' | 'right' | 'up' | 'down';
  distance: number;
  velocity: number;
}

interface TouchGesturesOptions {
  onSwipe?: (swipe: SwipeInfo) => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onTap?: () => void;
  onLongPress?: () => void;
  threshold?: number;
  longPressDelay?: number;
}

export function useTouchGestures(options: TouchGesturesOptions) {
  const {
    onSwipe,
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    onTap,
    onLongPress,
    threshold = 50,
    longPressDelay = 500,
  } = options;

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

    if (onLongPress) {
      longPressTimerRef.current = setTimeout(() => {
        onLongPress();
      }, longPressDelay);
    }
  }, [onLongPress, longPressDelay]);

  const handleTouchMove = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    const start = touchStartRef.current;
    const endX = touch.clientX;
    const endY = touch.clientY;
    const endTime = Date.now();

    const deltaX = endX - start.x;
    const deltaY = endY - start.y;
    const deltaTime = endTime - start.time;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Determine if it's a swipe or tap
    if (absX < threshold && absY < threshold) {
      // It's a tap
      if (deltaTime < longPressDelay) {
        onTap?.();
      }
    } else if (absX > absY) {
      // Horizontal swipe
      const direction = deltaX > 0 ? 'right' : 'left';
      const distance = absX;
      const velocity = distance / deltaTime;

      onSwipe?.({ direction, distance, velocity });

      if (direction === 'left') onSwipeLeft?.();
      else onSwipeRight?.();
    } else {
      // Vertical swipe
      const direction = deltaY > 0 ? 'down' : 'up';
      const distance = absY;
      const velocity = distance / deltaTime;

      onSwipe?.({ direction, distance, velocity });

      if (direction === 'up') onSwipeUp?.();
      else onSwipeDown?.();
    }

    touchStartRef.current = null;
  }, [onSwipe, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, onTap, threshold, longPressDelay]);

  const handleTouchCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  }, []);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchCancel,
  };
}

// Hook for pull to refresh
export function usePullToRefresh(
  onRefresh: () => void | Promise<void>,
  options: { threshold?: number; disabled?: boolean } = {}
) {
  const { threshold = 80, disabled = false } = options;
  
  const startYRef = useRef(0);
  const isPullingRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled || isRefreshing) return;
    
    // Only enable pull to refresh when at top of page
    if (window.scrollY > 0) return;
    
    startYRef.current = e.touches[0].clientY;
    isPullingRef.current = true;
  }, [disabled, isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPullingRef.current || disabled) return;

    const currentY = e.touches[0].clientY;
    const distance = Math.max(0, currentY - startYRef.current);
    
    // Add resistance
    const resistedDistance = Math.min(distance * 0.5, threshold * 1.5);
    setPullDistance(resistedDistance);
  }, [disabled, threshold]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPullingRef.current || disabled) return;

    isPullingRef.current = false;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      await onRefresh();
      setIsRefreshing(false);
    }

    setPullDistance(0);
  }, [pullDistance, threshold, isRefreshing, onRefresh, disabled]);

  return {
    pullDistance,
    isRefreshing,
    pullHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}
