import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { files: ['e2e/**/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      // Защита от внедрения скриптов (XSS): вставлять HTML из данных запрещено.
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Запрещено: риск XSS.' },
        { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'Запрещено: риск XSS.' },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'Запрещено: риск XSS.' },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']", message: 'Запрещено.' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // К серверу обращается только слой src/api/ — см. ТЗ, раздел 4.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/api/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: '@supabase/supabase-js', message: 'Работайте с сервером через src/api/.' }] },
      ],
    },
  },
);
