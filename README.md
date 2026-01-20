# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## 실행 화면
<img width="1183" height="907" alt="image" src="https://github.com/user-attachments/assets/2af70d28-13d9-401f-9f99-55754da61501" />


## 다른 곳에서 작업 하기

1. 소스 코드 내려받기 (Clone)
새 PC의 원하는 폴더에서 터미널(CMD 또는 PowerShell)을 열고 아래 명령어를 입력합니다.

powershell
git clone https://github.com/bongseob/MusicCreate.git
cd MusicCreate
2. 필수 소프트웨어 설치
Node.js: 공식 사이트에서 LTS 버전을 설치합니다.
Python (3.12 이상 추천): 공식 사이트에서 설치합니다.
중요: 설치 시 "Add Python to PATH" 옵션을 반드시 체크해 주세요.
3. 의존성 패키지 설치
프로젝트 폴더 안에서 아래 명령어들을 실행하여 필요한 도구들을 설치합니다.

Node.js 패키지 설치:

powershell
npm install
Python AI 엔진 패키지 설치 (중요):

powershell
pip install --user demucs soundfile av torchcodec
4. 환경 설정 (.env)
보안상 .env 파일은 GitHub에 올라가지 않습니다. 기존 PC의 프로젝트 폴더에 있는 .env 파일을 복사해서 새 PC의 프로젝트 루트 폴더에 넣어주세요.

내용 예시: SUNO_API_KEY=여러분의_키_값
5. 프로그램 실행
모든 준비가 끝났습니다. 아래 명령어로 프로그램을 실행합니다.

powershell
npm run electron-dev

## 🎫 JWT 토큰 추출 방법 (무료 인증)

Suno AI를 무료로 사용하려면 JWT 토큰이 필요합니다. 아래 스크립트를 사용하면 쉽게 추출할 수 있습니다.

### 사용법:
1. **[suno.com](https://suno.com)** 로그인
2. **`F12`** → **Console** 탭 클릭
3. 아래 코드 붙여넣기 후 **Enter**:

```javascript
// Suno JWT Token 자동 추출기
const cookies = document.cookie.split(';');
const sessionCookie = cookies.find(c => c.trim().startsWith('__session='));
if (sessionCookie) {
  const token = sessionCookie.split('=')[1];
  navigator.clipboard.writeText(token);
  alert('✅ JWT 토큰이 클립보드에 복사되었습니다!\n\n앱에 붙여넣기(Ctrl+V) 하세요.');
} else {
  alert('❌ 토큰을 찾을 수 없습니다. 로그인 상태를 확인하세요.');
}
```

4. 앱으로 돌아와서 **`Ctrl+V`** 붙여넣기!

> ⚠️ **주의**: 토큰은 약 1시간 후 만료됩니다. 만료 시 위 과정을 다시 진행하세요.
