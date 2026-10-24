import tseslint from 'typescript-eslint';

const dataBoundary = 'Database access belongs in packages/data. Export a named data function and call it here.';

export default [
  { ignores: ['**/.next/**', '**/node_modules/**'] },
  {
    files: ['apps/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'pg', message: dataBoundary }, { name: 'node:sqlite', message: dataBoundary }],
        patterns: [{ group: ['pg/*'], message: dataBoundary }],
      }],
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='query']", message: dataBoundary },
        { selector: "CallExpression[callee.type='MemberExpression'][callee.property.value='query']", message: dataBoundary },
      ],
    },
  },
];
