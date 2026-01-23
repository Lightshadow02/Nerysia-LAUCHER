/**
 * Management of the UI Theme.
 */

/**
 * Sets the theme of the application.
 *
 * @param {string} theme The theme to apply ('dark' or 'light').
 */
function setTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('theme-light')
    } else {
        document.body.classList.remove('theme-light')
    }
    localStorage.setItem('launcher_theme', theme)
}

/**
 * Toggles the theme between light and dark.
 */
function toggleTheme() {
    if (document.body.classList.contains('theme-light')) {
        setTheme('dark')
    } else {
        setTheme('light')
    }
}

/**
 * Returns the current theme.
 *
 * @returns {string} 'light' or 'dark'
 */
function getTheme() {
    return document.body.classList.contains('theme-light') ? 'light' : 'dark'
}

// Apply theme on load
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('launcher_theme')
    if (savedTheme === 'light') {
        document.body.classList.add('theme-light')
    }
})
