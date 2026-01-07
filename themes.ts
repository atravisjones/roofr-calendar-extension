import { Theme } from './types';

export interface ThemeColors {
    name: string;
    description: string;
    colors: {
        // Background colors
        bgPrimary: string;
        bgSecondary: string;
        bgTertiary: string;

        // Text colors
        textPrimary: string;
        textSecondary: string;
        textMuted: string;

        // Border and accent colors
        border: string;
        borderLight: string;
        accent: string;
        accentHover: string;
        accentLight: string;

        // Status colors
        success: string;
        successBg: string;
        successBorder: string;
        error: string;
        errorBg: string;
        errorBorder: string;
        warning: string;
        warningBg: string;
        warningBorder: string;

        // Interactive elements
        hoverBg: string;
        cardBg: string;
        cardBorder: string;
    };
}

export const THEMES: Record<Theme, ThemeColors> = {
    light: {
        name: 'Light',
        description: 'Clean and bright default theme',
        colors: {
            bgPrimary: '#ffffff',
            bgSecondary: '#f8fafc',
            bgTertiary: '#f1f5f9',
            textPrimary: '#0f172a',
            textSecondary: '#475569',
            textMuted: '#64748b',
            border: '#e2e8f0',
            borderLight: '#f1f5f9',
            accent: '#3b82f6',
            accentHover: '#2563eb',
            accentLight: '#dbeafe',
            success: '#16a34a',
            successBg: '#dcfce7',
            successBorder: '#86efac',
            error: '#dc2626',
            errorBg: '#fee2e2',
            errorBorder: '#fca5a5',
            warning: '#ea580c',
            warningBg: '#fed7aa',
            warningBorder: '#fdba74',
            hoverBg: '#dbeafe',
            cardBg: '#ffffff',
            cardBorder: '#e2e8f0',
        }
    },
    dark: {
        name: 'Dark',
        description: 'Easy on the eyes',
        colors: {
            bgPrimary: '#0f172a',
            bgSecondary: '#1e293b',
            bgTertiary: '#334155',
            textPrimary: '#f8fafc',
            textSecondary: '#cbd5e1',
            textMuted: '#94a3b8',
            border: '#334155',
            borderLight: '#475569',
            accent: '#60a5fa',
            accentHover: '#3b82f6',
            accentLight: '#1e3a8a',
            success: '#22c55e',
            successBg: '#14532d',
            successBorder: '#166534',
            error: '#ef4444',
            errorBg: '#7f1d1d',
            errorBorder: '#991b1b',
            warning: '#f97316',
            warningBg: '#7c2d12',
            warningBorder: '#9a3412',
            hoverBg: '#1e3a8a',
            cardBg: '#1e293b',
            cardBorder: '#334155',
        }
    },
    ocean: {
        name: 'Ocean',
        description: 'Deep blue waters and coral reefs',
        colors: {
            bgPrimary: '#f0f9ff',
            bgSecondary: '#e0f2fe',
            bgTertiary: '#bae6fd',
            textPrimary: '#0c4a6e',
            textSecondary: '#075985',
            textMuted: '#0369a1',
            border: '#7dd3fc',
            borderLight: '#bae6fd',
            accent: '#0ea5e9',
            accentHover: '#0284c7',
            accentLight: '#e0f2fe',
            success: '#14b8a6',
            successBg: '#ccfbf1',
            successBorder: '#5eead4',
            error: '#e11d48',
            errorBg: '#ffe4e6',
            errorBorder: '#fda4af',
            warning: '#f59e0b',
            warningBg: '#fef3c7',
            warningBorder: '#fcd34d',
            hoverBg: '#bae6fd',
            cardBg: '#ffffff',
            cardBorder: '#7dd3fc',
        }
    },
    forest: {
        name: 'Forest',
        description: 'Lush greenery and woodland calm',
        colors: {
            bgPrimary: '#f0fdf4',
            bgSecondary: '#dcfce7',
            bgTertiary: '#bbf7d0',
            textPrimary: '#14532d',
            textSecondary: '#166534',
            textMuted: '#15803d',
            border: '#86efac',
            borderLight: '#bbf7d0',
            accent: '#16a34a',
            accentHover: '#15803d',
            accentLight: '#dcfce7',
            success: '#22c55e',
            successBg: '#dcfce7',
            successBorder: '#86efac',
            error: '#dc2626',
            errorBg: '#fee2e2',
            errorBorder: '#fca5a5',
            warning: '#eab308',
            warningBg: '#fef9c3',
            warningBorder: '#fde047',
            hoverBg: '#bbf7d0',
            cardBg: '#ffffff',
            cardBorder: '#86efac',
        }
    },
    desert: {
        name: 'Desert',
        description: 'Warm sands and sunset hues',
        colors: {
            bgPrimary: '#fffbeb',
            bgSecondary: '#fef3c7',
            bgTertiary: '#fde68a',
            textPrimary: '#78350f',
            textSecondary: '#92400e',
            textMuted: '#b45309',
            border: '#fcd34d',
            borderLight: '#fde68a',
            accent: '#f59e0b',
            accentHover: '#d97706',
            accentLight: '#fef3c7',
            success: '#84cc16',
            successBg: '#ecfccb',
            successBorder: '#bef264',
            error: '#dc2626',
            errorBg: '#fee2e2',
            errorBorder: '#fca5a5',
            warning: '#ea580c',
            warningBg: '#ffedd5',
            warningBorder: '#fdba74',
            hoverBg: '#fde68a',
            cardBg: '#ffffff',
            cardBorder: '#fcd34d',
        }
    },
    arctic: {
        name: 'Arctic',
        description: 'Crisp ice and northern lights',
        colors: {
            bgPrimary: '#f0fdfa',
            bgSecondary: '#ccfbf1',
            bgTertiary: '#99f6e4',
            textPrimary: '#134e4a',
            textSecondary: '#115e59',
            textMuted: '#0f766e',
            border: '#5eead4',
            borderLight: '#99f6e4',
            accent: '#14b8a6',
            accentHover: '#0d9488',
            accentLight: '#ccfbf1',
            success: '#10b981',
            successBg: '#d1fae5',
            successBorder: '#6ee7b7',
            error: '#ef4444',
            errorBg: '#fee2e2',
            errorBorder: '#fca5a5',
            warning: '#06b6d4',
            warningBg: '#cffafe',
            warningBorder: '#67e8f9',
            hoverBg: '#99f6e4',
            cardBg: '#ffffff',
            cardBorder: '#5eead4',
        }
    },
    savanna: {
        name: 'Savanna',
        description: 'Golden grasslands and earthen tones',
        colors: {
            bgPrimary: '#fefce8',
            bgSecondary: '#fef9c3',
            bgTertiary: '#fef08a',
            textPrimary: '#713f12',
            textSecondary: '#854d0e',
            textMuted: '#a16207',
            border: '#fde047',
            borderLight: '#fef08a',
            accent: '#ca8a04',
            accentHover: '#a16207',
            accentLight: '#fef9c3',
            success: '#65a30d',
            successBg: '#ecfccb',
            successBorder: '#bef264',
            error: '#dc2626',
            errorBg: '#fee2e2',
            errorBorder: '#fca5a5',
            warning: '#ea580c',
            warningBg: '#fed7aa',
            warningBorder: '#fdba74',
            hoverBg: '#fef08a',
            cardBg: '#ffffff',
            cardBorder: '#fde047',
        }
    },
    jungle: {
        name: 'Jungle',
        description: 'Vibrant tropical paradise',
        colors: {
            bgPrimary: '#f7fee7',
            bgSecondary: '#ecfccb',
            bgTertiary: '#d9f99d',
            textPrimary: '#1a2e05',
            textSecondary: '#365314',
            textMuted: '#3f6212',
            border: '#bef264',
            borderLight: '#d9f99d',
            accent: '#65a30d',
            accentHover: '#4d7c0f',
            accentLight: '#ecfccb',
            success: '#16a34a',
            successBg: '#dcfce7',
            successBorder: '#86efac',
            error: '#dc2626',
            errorBg: '#fee2e2',
            errorBorder: '#fca5a5',
            warning: '#f59e0b',
            warningBg: '#fef3c7',
            warningBorder: '#fcd34d',
            hoverBg: '#d9f99d',
            cardBg: '#ffffff',
            cardBorder: '#bef264',
        }
    }
};

export function applyTheme(theme: Theme): void {
    const themeColors = THEMES[theme].colors;
    const root = document.documentElement;

    // Apply CSS variables
    Object.entries(themeColors).forEach(([key, value]) => {
        const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
        root.style.setProperty(cssVarName, value);
    });
}

export function getThemeForBody(theme: Theme): string {
    const themeColors = THEMES[theme].colors;
    return `
        background-color: ${themeColors.bgSecondary};
        color: ${themeColors.textPrimary};
    `;
}
