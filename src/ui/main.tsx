import './styles.css';
import { boot } from './config';
import { bootWeb } from './web';
import { bootWidget } from './widget';

const root = document.getElementById('app')!;
// The server injects mode "widget" into the MCP App resource. Everything else (website, offline file) is the web app.
if (boot.mode === 'widget') void bootWidget(root);
else bootWeb(root);
