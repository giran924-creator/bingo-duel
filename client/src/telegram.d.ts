export {};
declare global {
  interface TelegramSafeAreaInset {
    top: number;
    bottom: number;
    left: number;
    right: number;
  }
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: { start_param?: string };
        colorScheme: "light" | "dark";
        themeParams: Record<string, string>;
        safeAreaInset?: TelegramSafeAreaInset;
        contentSafeAreaInset?: TelegramSafeAreaInset;
        viewportStableHeight?: number;
        ready: () => void;
        expand: () => void;
        openTelegramLink: (url: string) => void;
        HapticFeedback?: {
          impactOccurred: (style: "light" | "medium" | "heavy") => void;
          notificationOccurred: (kind: "success" | "error" | "warning") => void;
        };
        onEvent: (name: string, callback: () => void) => void;
        offEvent: (name: string, callback: () => void) => void;
        enableClosingConfirmation?: () => void;
        disableClosingConfirmation?: () => void;
      };
    };
  }
}
