/**
 * Throttling and debouncing utilities for performance optimization
 */

/**
 * Throttle function execution to at most once per interval
 * Guarantees that the function is called at most once per interval,
 * and that the last call is always executed.
 */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  intervalMs: number
): (...args: Parameters<T>) => void {
  let lastCallTime = 0;
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingArgs: Parameters<T> | null = null;

  return function throttled(...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    // Clear any pending timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (timeSinceLastCall >= intervalMs) {
      // Enough time has passed, execute immediately
      lastCallTime = now;
      fn(...args);
      pendingArgs = null;
    } else {
      // Too soon, schedule for later
      pendingArgs = args;
      const remainingTime = intervalMs - timeSinceLastCall;

      timeoutId = setTimeout(() => {
        lastCallTime = Date.now();
        if (pendingArgs) {
          fn(...pendingArgs);
          pendingArgs = null;
        }
        timeoutId = null;
      }, remainingTime);
    }
  };
}

/**
 * Debounce function execution
 * Only executes the function after the specified delay has passed
 * without any new calls
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return function debounced(...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delayMs);
  };
}

/**
 * Rate limiter using token bucket algorithm
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillTime: number;

  constructor(
    private capacity: number,
    private refillRate: number, // tokens per second
    private refillIntervalMs: number = 1000
  ) {
    this.tokens = capacity;
    this.lastRefillTime = Date.now();
  }

  /**
   * Try to consume tokens
   * Returns true if successful, false if not enough tokens
   */
  tryConsume(count: number = 1): boolean {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }

    return false;
  }

  /**
   * Get current token count
   */
  getTokenCount(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Reset bucket to full capacity
   */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefillTime = Date.now();
  }

  /**
   * Refill tokens based on time passed
   */
  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefillTime;
    const intervalsPasssed = timePassed / this.refillIntervalMs;
    const tokensToAdd = intervalsPasssed * this.refillRate;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }
}
