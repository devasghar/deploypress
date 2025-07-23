#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

class DeployPress {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    this.config = {
      localPath: process.cwd(),
      wpRoot: '',
      dbPath: '',
      sshUser: '',
      sshHost: '',
      sshPort: '22',
      remotePath: '',
      dbUser: '',
      dbPass: '',
      dbName: '',
      excludes: ['.git/', '.github/', '.idea/', 'node_modules/', 'vendor/', '.DS_Store', '*.log', 'wp-config.php', '.htaccess']
    };
  }

  // Utility methods
  log(message, color = 'green') {
    console.log(`${colors[color]}[INFO]${colors.reset} ${message}`);
  }

  warn(message) {
    console.log(`${colors.yellow}[WARNING]${colors.reset} ${message}`);
  }

  error(message) {
    console.log(`${colors.red}[ERROR]${colors.reset} ${message}`);
  }

  section(title) {
    console.log(`\n${colors.blue}=== ${title} ===${colors.reset}`);
  }

  // Check if required commands exist
  checkDependencies() {
    const required = ['rsync', 'ssh', 'scp'];
    const missing = [];

    for (const cmd of required) {
      try {
        execSync(`which ${cmd}`, { stdio: 'ignore' });
      } catch (error) {
        missing.push(cmd);
      }
    }

    if (missing.length > 0) {
      this.error(`Missing required commands: ${missing.join(', ')}`);
      this.error('Please install the missing commands and try again.');
      process.exit(1);
    }
  }

  // Promisify readline question
  question(prompt) {
    return new Promise((resolve) => {
      this.rl.question(prompt, resolve);
    });
  }

  // Hidden password input
  async passwordQuestion(prompt) {
    return new Promise((resolve) => {
      process.stdout.write(prompt);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      
      let password = '';
      
      const onData = (char) => {
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            console.log();
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.exit();
            break;
          case '\u007f': // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      };
      
      process.stdin.on('data', onData);
    });
  }

  // Validate input
  validateNotEmpty(input, fieldName) {
    if (!input || input.trim() === '') {
      this.error(`${fieldName} cannot be empty.`);
      return false;
    }
    return true;
  }

  // Test SSH connection
  async testSSHConnection() {
    this.log(`Testing SSH connection to ${this.config.sshUser}@${this.config.sshHost}:${this.config.sshPort}...`);
    
    return new Promise((resolve) => {
      const ssh = spawn('ssh', [
        '-o', 'ConnectTimeout=10',
        '-o', 'BatchMode=yes',
        '-p', this.config.sshPort,
        `${this.config.sshUser}@${this.config.sshHost}`,
        'exit'
      ]);

      ssh.on('close', (code) => {
        if (code === 0) {
          this.log('SSH connection successful!');
          resolve(true);
        } else {
          this.error('SSH connection failed. Please check your credentials.');
          resolve(false);
        }
      });

      ssh.on('error', () => {
        this.error('SSH connection failed. Please check your credentials.');
        resolve(false);
      });
    });
  }

  // Execute command with retry logic
  async executeWithRetry(command, maxRetries = 3, description = '') {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.log(`${description} - Attempt ${attempt} of ${maxRetries}`);
      
      try {
        execSync(command, { stdio: 'inherit', timeout: 300000 }); // 5 minute timeout
        this.log(`${description} completed successfully!`);
        return true;
      } catch (error) {
        if (attempt < maxRetries) {
          this.warn(`${description} failed, retrying in 5 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else {
          this.error(`${description} failed after ${maxRetries} attempts`);
          return false;
        }
      }
    }
  }

  // Create remote backup
  async createRemoteBackup() {
    this.section('Creating Remote Backup');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                     new Date().toTimeString().split(' ')[0].replace(/:/g, '');
    const backupDir = `/tmp/backup_${timestamp}`;
    const localBackupDir = `./backups/backup_${timestamp}`;

    // Create backup directory on remote
    const createDirCmd = `ssh -p ${this.config.sshPort} ${this.config.sshUser}@${this.config.sshHost} "mkdir -p ${backupDir}"`;
    
    try {
      execSync(createDirCmd, { stdio: 'inherit' });
      
      // Backup files
      this.log('Backing up remote files...');
      const fileBackupCmd = `ssh -p ${this.config.sshPort} ${this.config.sshUser}@${this.config.sshHost} "tar -czf ${backupDir}/files_backup.tar.gz -C $(dirname ${this.config.remotePath}) $(basename ${this.config.remotePath}) 2>/dev/null || true"`;
      execSync(fileBackupCmd, { stdio: 'inherit' });

      // Backup database
      this.log('Backing up remote database...');
      const dbBackupCmd = `ssh -p ${this.config.sshPort} ${this.config.sshUser}@${this.config.sshHost} "mysqldump -u '${this.config.dbUser}' -p'${this.config.dbPass}' '${this.config.dbName}' | gzip > ${backupDir}/database_backup.sql.gz 2>/dev/null || true"`;
      execSync(dbBackupCmd, { stdio: 'inherit' });

      // Download backup
      this.log('Downloading backup to local machine...');
      if (!fs.existsSync('./backups')) {
        fs.mkdirSync('./backups', { recursive: true });
      }
      
      const downloadCmd = `scp -P ${this.config.sshPort} -r ${this.config.sshUser}@${this.config.sshHost}:${backupDir}/* ${localBackupDir}/`;
      try {
        fs.mkdirSync(localBackupDir, { recursive: true });
        execSync(downloadCmd, { stdio: 'inherit' });
        this.log(`Backup downloaded to: ${localBackupDir}`);
      } catch (error) {
        this.warn(`Backup download failed, but backup exists on remote server at: ${backupDir}`);
      }

    } catch (error) {
      this.error('Backup creation failed: ' + error.message);
      return false;
    }
    
    return true;
  }

  // Sync files
  async syncFiles() {
    this.section('Syncing Files');
    
    const excludeParams = this.config.excludes.map(exclude => `--exclude='${exclude}'`).join(' ');
    const localFullPath = path.join(this.config.localPath, this.config.wpRoot === '.' ? '' : this.config.wpRoot) + '/';
    
    this.log(`Syncing from: ${localFullPath}`);
    this.log(`Syncing to: ${this.config.sshUser}@${this.config.sshHost}:${this.config.remotePath}`);
    
    const syncCmd = `rsync -avz --timeout=300 --partial --inplace ${excludeParams} -e 'ssh -p ${this.config.sshPort}' '${localFullPath}' '${this.config.sshUser}@${this.config.sshHost}:${this.config.remotePath}'`;
    
    return await this.executeWithRetry(syncCmd, 3, 'File synchronization');
  }

  // Deploy database
  async deployDatabase() {
    this.section('Deploying Database');
    
    const dbFullPath = path.join(this.config.localPath, this.config.dbPath);
    
    if (!fs.existsSync(dbFullPath)) {
      this.error(`Database file not found: ${dbFullPath}`);
      return false;
    }

    // Upload database
    const uploadCmd = `scp -P ${this.config.sshPort} '${dbFullPath}' '${this.config.sshUser}@${this.config.sshHost}:/tmp/deploy_database.sql.gz'`;
    
    // Import database
    const importCmd = `ssh -p ${this.config.sshPort} '${this.config.sshUser}@${this.config.sshHost}' "export LC_ALL=C && gzip -dc /tmp/deploy_database.sql.gz | mysql -u '${this.config.dbUser}' -p'${this.config.dbPass}' '${this.config.dbName}' && rm /tmp/deploy_database.sql.gz"`;
    
    const combinedCmd = `${uploadCmd} && ${importCmd}`;
    
    return await this.executeWithRetry(combinedCmd, 3, 'Database deployment');
  }

  // Main configuration collection
  async collectConfiguration() {
    this.section('DeployPress - WordPress Deployment Configuration');

    // Local project path
    let input = await this.question(`Enter local project path (current: ${this.config.localPath}): `);
    if (input.trim()) {
      this.config.localPath = input.trim();
    }

    if (!fs.existsSync(this.config.localPath)) {
      this.error(`Directory does not exist: ${this.config.localPath}`);
      process.exit(1);
    }

    // WordPress root folder
    do {
      this.config.wpRoot = await this.question("Enter WordPress root folder relative to project (e.g., 'public', 'wp', or '.' for root): ");
    } while (!this.validateNotEmpty(this.config.wpRoot, 'WordPress root folder'));

    // Validate WordPress directory
    const wpFullPath = this.config.wpRoot === '.' ? 
      this.config.localPath : 
      path.join(this.config.localPath, this.config.wpRoot);
    
    if (!fs.existsSync(wpFullPath)) {
      this.error(`WordPress directory not found: ${wpFullPath}`);
      process.exit(1);
    }

    // Database path
    do {
      this.config.dbPath = await this.question("Enter database file path (relative to project, e.g., 'database/database.sql.gz'): ");
      if (this.validateNotEmpty(this.config.dbPath, 'Database path')) {
        const dbFullPath = path.join(this.config.localPath, this.config.dbPath);
        if (fs.existsSync(dbFullPath)) {
          break;
        } else {
          this.error(`Database file not found: ${dbFullPath}`);
          this.config.dbPath = '';
        }
      }
    } while (!this.config.dbPath);

    // SSH details
    do {
      this.config.sshUser = await this.question('Enter SSH username: ');
    } while (!this.validateNotEmpty(this.config.sshUser, 'SSH username'));

    do {
      this.config.sshHost = await this.question('Enter server IP/hostname: ');
    } while (!this.validateNotEmpty(this.config.sshHost, 'Server IP/hostname'));

    input = await this.question('Enter SSH port (default: 22): ');
    if (input.trim()) {
      this.config.sshPort = input.trim();
    }

    do {
      this.config.remotePath = await this.question('Enter remote WordPress path: ');
    } while (!this.validateNotEmpty(this.config.remotePath, 'Remote path'));

    // Database credentials
    do {
      this.config.dbUser = await this.question('Enter database username: ');
    } while (!this.validateNotEmpty(this.config.dbUser, 'Database username'));

    do {
      this.config.dbPass = await this.passwordQuestion('Enter database password: ');
    } while (!this.validateNotEmpty(this.config.dbPass, 'Database password'));

    do {
      this.config.dbName = await this.question('Enter database name: ');
    } while (!this.validateNotEmpty(this.config.dbName, 'Database name'));

    // Additional excludes
    console.log('\nDefault excluded files/directories:');
    this.config.excludes.forEach(exclude => console.log(`  ${exclude}`));
    
    const additionalExcludes = await this.question('Add additional excludes (comma-separated, or press Enter to use defaults): ');
    if (additionalExcludes.trim()) {
      const additional = additionalExcludes.split(',').map(item => item.trim()).filter(item => item);
      this.config.excludes.push(...additional);
    }
  }

  // Display deployment summary
  displaySummary() {
    this.section('Deployment Summary');
    console.log(`Local Path: ${path.join(this.config.localPath, this.config.wpRoot === '.' ? '' : this.config.wpRoot)}`);
    console.log(`Remote Path: ${this.config.sshUser}@${this.config.sshHost}:${this.config.remotePath}`);
    console.log(`Database: ${path.join(this.config.localPath, this.config.dbPath)} -> ${this.config.dbName}`);
    console.log(`Excludes: ${this.config.excludes.join(', ')}`);
  }

  // Main deployment process
  async deploy() {
    try {
      // Check dependencies
      this.checkDependencies();

      // Collect configuration
      await this.collectConfiguration();

      // Display summary and confirm
      this.displaySummary();
      const confirm = await this.question('\nProceed with deployment? (y/N): ');
      
      if (confirm.toLowerCase() !== 'y') {
        this.log('Deployment cancelled.');
        process.exit(0);
      }

      // Test SSH connection
      if (!(await this.testSSHConnection())) {
        process.exit(1);
      }

      // Create backup
      const createBackup = await this.question('Create backup before deployment? (Y/n): ');
      if (createBackup.toLowerCase() !== 'n') {
        if (!(await this.createRemoteBackup())) {
          this.error('Backup creation failed. Aborting deployment.');
          process.exit(1);
        }
      }

      // Deploy files
      if (!(await this.syncFiles())) {
        this.error('File deployment failed. Aborting database deployment.');
        process.exit(1);
      }

      // Deploy database
      const deployDb = await this.question('Deploy database? (Y/n): ');
      if (deployDb.toLowerCase() !== 'n') {
        if (!(await this.deployDatabase())) {
          this.error('Database deployment failed.');
          process.exit(1);
        }
      }

      this.section('Deployment Completed Successfully!');
      this.log(`Your WordPress site has been deployed to ${this.config.sshUser}@${this.config.sshHost}:${this.config.remotePath}`);

    } catch (error) {
      this.error('Deployment failed: ' + error.message);
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }
}

// Run the deployer
if (require.main === module) {
  const deployer = new DeployPress();
  deployer.deploy();
}

module.exports = DeployPress;