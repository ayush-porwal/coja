# @ayushporwal/coja

Local code review for GitHub pull requests, with an AI sidepanel that helps the human reviewer.

Coja pulls a pull request into a local clone and reviews it in a fast, GitHub-style diff UI — file tree, line comments, pending review, approve or request changes. An AI sidepanel sits next to the diff, grounded in the same PR: it reads the changed files, answers questions, and helps you write the review. Everything runs on your machine.

## Install

```sh
npm install -g @ayushporwal/coja
```

or, if you don't want to install

```sh
npx @ayushporwal/coja
```

Then run:

```sh
coja
```

Coja starts a local server on `http://localhost:4321` and opens your browser. First-run setup walks you through adding a GitHub token (stored in your OS keychain), a project to review, and — optionally — an AI provider key for the sidepanel.

## Requirements

- Node.js 22.13 or newer

## Links

- [Repository & full documentation](https://github.com/ayush-porwal/coja)
- [Issue tracker](https://github.com/ayush-porwal/coja/issues)

## License

[MIT](https://github.com/ayush-porwal/coja/blob/main/LICENSE)
