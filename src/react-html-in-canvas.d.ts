import 'react';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> {
    /** HTML-in-Canvas: the element can be drawn into its canvas on its own. */
    drawable?: string;
  }
}
