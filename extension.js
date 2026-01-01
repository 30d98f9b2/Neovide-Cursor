const vscode = require('vscode');
const path = require('path');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	console.log('Neovide Cursor extension is now active!');

	// 打开用户配置命令
	const openConfigCommand = vscode.commands.registerCommand('neovideCursor.openConfig', async () => {
		try {
			// 获取当前扩展路径
			const extensionPath = context.extensionPath;
			const configFilePath = path.join(extensionPath, 'neovide-cursor.js');
			
			// 检查文件是否存在
			const fs = require('fs');
			if (!fs.existsSync(configFilePath)) {
				vscode.window.showErrorMessage(`找不到配置文件: ${configFilePath}`);
				return;
			}

			// 打开配置文件
			const document = await vscode.workspace.openTextDocument(configFilePath);
			await vscode.window.showTextDocument(document);
			
			vscode.window.showInformationMessage(
				`已打开配置文件！您可以在这里修改参数，保存后输入 >Reload Custom CSS and JS 重新加载以生效`
			);
			
		} catch (error) {
			console.error('打开配置文件时出错:', error);
			vscode.window.showErrorMessage(`打开配置文件时出错: ${error.message}`);
		}
	});

	// 生成路径命令
	const generatePathCommand = vscode.commands.registerCommand('neovideCursor.generatePath', async () => {
		try {
			// 获取当前扩展路径
			const extensionPath = context.extensionPath;
			
			// 构建 neovide-cursor.js 的完整路径
			const cursorScriptPath = path.join(extensionPath, 'neovide-cursor.js');
			
			// 检查文件是否存在
			const fs = require('fs');
			if (!fs.existsSync(cursorScriptPath)) {
				vscode.window.showErrorMessage(
					`找不到 neovide-cursor.js 文件在路径: ${cursorScriptPath}`
				);
				return;
			}

			// 将路径转换为适合 Custom CSS & JS Loader 的格式
			const fileUri = vscode.Uri.file(cursorScriptPath).toString();
			
			// 使用正确的配置键名和结构
			const configKey = 'vscode_custom_css';
			const configProperty = 'imports';
			const customCssJsConfig = vscode.workspace.getConfiguration(configKey);
			
			console.log(`使用配置键名: ${configKey}`);
			
			// 获取现有的导入文件列表
			const existingImports = customCssJsConfig.get(configProperty) || [];
			
			// 检查是否已经添加了此文件
			const fileAlreadyAdded = existingImports.some(importPath => {
				return importPath === fileUri || importPath === cursorScriptPath;
			});
			
			if (fileAlreadyAdded) {
				// 如果已经存在，显示提示
				vscode.window.showInformationMessage(
					`路径已存在！请输入 >Reload Custom CSS and JS 重新加载以生效`
				);
			} else {
				// 如果不存在，询问是否要添加
				const selection = await vscode.window.showInformationMessage(
					'确定要将 neovide-cursor.js 添加到 Custom CSS and JS Loader 吗？',
					'添加',
					'取消'
				);
				
				if (selection !== '添加') {
					return;
				}
				
				// 添加到导入列表
				const updatedImports = [...existingImports, fileUri];
				
				// 更新配置
				await customCssJsConfig.update(configProperty, updatedImports, vscode.ConfigurationTarget.Global);
				
				vscode.window.showInformationMessage(
					`路径已生成！请输入 >Reload Custom CSS and JS 重新加载以生效`
				);
			}
			
		} catch (error) {
			console.error('生成路径时出错:', error);
			vscode.window.showErrorMessage(`生成路径时出错: ${error.message}`);
		}
	});

	// 删除生成的路径命令
	const removePathCommand = vscode.commands.registerCommand('neovideCursor.removePath', async () => {
		try {
			// 获取当前扩展路径
			const extensionPath = context.extensionPath;
			const cursorScriptPath = path.join(extensionPath, 'neovide-cursor.js');
			
			// 将路径转换为file://格式
			const fileUri = vscode.Uri.file(cursorScriptPath).toString();
			
			// 获取Custom CSS & JS Loader配置
			const configKey = 'vscode_custom_css';
			const configProperty = 'imports';
			const customCssJsConfig = vscode.workspace.getConfiguration(configKey);
			
			// 获取现有导入列表
			const existingImports = customCssJsConfig.get(configProperty) || [];
			
			// 智能检测：查找所有可能相关的neovide-cursor导入
			const neovideRelatedImports = existingImports.filter(importPath => {
				const lowerPath = importPath.toLowerCase();
				return lowerPath.includes('neovide') || 
					   lowerPath.includes('cursor') ||
					   lowerPath.includes(path.basename(cursorScriptPath));
			});
			
			// 检查是否存在neovide相关文件
			if (neovideRelatedImports.length === 0) {
				vscode.window.showInformationMessage('没有找到已生成的 neovide-cursor 相关路径');
				return;
			}
			
			// 询问是否要删除路径
			const selection = await vscode.window.showInformationMessage(
				`确定要删除生成的路径吗？\n将移除 ${neovideRelatedImports.length} 个 neovide-cursor 相关路径，保留 ${existingImports.length - neovideRelatedImports.length} 个其他插件路径`,
				'删除',
				'取消'
			);
			
			if (selection !== '删除') {
				return;
			}
			
			// 只移除neovide相关的导入，保留其他插件的导入
			const updatedImports = existingImports.filter(importPath => {
				const lowerPath = importPath.toLowerCase();
				return !(lowerPath.includes('neovide') || 
						lowerPath.includes('cursor') ||
						lowerPath.includes(path.basename(cursorScriptPath)));
			});
			
			await customCssJsConfig.update(configProperty, updatedImports, vscode.ConfigurationTarget.Global);
			
			const removedCount = existingImports.length - updatedImports.length;
			vscode.window.showInformationMessage(
				`路径已删除！\n已删除 ${removedCount} 个 neovide-cursor 相关路径，保留 ${updatedImports.length} 个其他插件路径；\n\n请输入 >Reload Custom CSS and JS 重新加载以生效`
			);
			
		} catch (error) {
			console.error('删除路径时出错:', error);
			vscode.window.showErrorMessage(`删除路径时出错: ${error.message}`);
		}
	});

	// 注册命令
	context.subscriptions.push(generatePathCommand);
	context.subscriptions.push(removePathCommand);
	context.subscriptions.push(openConfigCommand);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}