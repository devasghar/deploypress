# DeployPress

A comprehensive WordPress deployment tool that handles file synchronization, database deployment, and automatic backups with network resilience and retry logic.

## Features

- 🚀 **Interactive Configuration**: Guided setup for all deployment parameters
- 🔄 **Automatic Backups**: Creates and downloads backups before deployment
- 🌐 **Network Resilient**: Retry logic for slow/unstable connections
- 🛡️ **Safe Deployment**: Validates paths and tests connections before deployment
- 📁 **Smart File Exclusion**: Default and custom file/directory exclusions
- 🔐 **Secure**: Hidden password input and SSH key support
- 📊 **Progress Tracking**: Colored output with clear status messages

## Requirements

- Node.js 14+
- SSH access to target server
- `rsync`, `ssh`, and `scp` commands available on your system
- MySQL/MariaDB on target server

## Installation & Usage

### Option 1: Run directly with NPX (Recommended)
```bash
npx deploypress
```

### Option 2: Global Installation
```bash
npm install -g deploypress
deploypress
```

### Option 3: Local Development
```bash
git clone <repository-url>
cd deploypress
npm install
node index.js
```

## What it does

1. **Configuration Collection**: Interactively collects all necessary deployment parameters
2. **Validation**: Validates local paths, SSH connections, and required files
3. **Backup Creation**: Creates timestamped backups of remote files and database
4. **File Synchronization**: Syncs local WordPress files to remote server with retry logic
5. **Database Deployment**: Uploads and imports database with compression support
6. **Verification**: Confirms successful deployment

## Configuration Options

The tool will prompt you for:

- **Local project path**: Your WordPress project directory
- **WordPress root**: Relative path to WordPress files (e.g., 'public', 'wp', or '.')
- **Database file**: Path to your .sql.gz database backup
- **SSH credentials**: Username, host, port, and remote path
- **Database credentials**: MySQL username, password, and database name
- **File exclusions**: Additional files/directories to skip during sync

## Default Exclusions

The following files/directories are excluded by default:
- `.git/`
- `.github/`
- `.idea/`
- `node_modules/`
- `vendor/`
- `.DS_Store`
- `*.log`
- `wp-config.php`
- `.htaccess`

You can add additional exclusions during the configuration process.

## Network Resilience

- **Timeout Protection**: 5-minute timeout for operations
- **Retry Logic**: Up to 3 attempts for failed operations
- **Partial Transfers**: Resumes interrupted file transfers
- **Connection Testing**: Validates SSH connectivity before deployment

## Backup System

- Creates timestamped backups on remote server
- Downloads backups to local `./backups/` directory
- Backs up both files and database
- Safe rollback capability

## Example Usage

```bash
# Run the deployment tool
npx deploypress

# Follow the interactive prompts:
# - Enter your local WordPress project path
# - Specify WordPress root directory (e.g., 'public')
# - Provide database file path (e.g., 'database/database.sql.gz')
# - Enter SSH connection details
# - Configure database credentials
# - Add any additional file exclusions
# - Confirm deployment and backup options
```

## Troubleshooting

### SSH Connection Issues
- Ensure SSH key authentication is set up
- Verify server hostname and port
- Check firewall settings

### File Sync Problems
- Verify local file paths exist
- Check remote directory permissions
- Ensure sufficient disk space on remote server

### Database Import Errors
- Verify database credentials
- Check MySQL user privileges
- Ensure database exists on remote server
- Validate .sql.gz file format

### Network Timeouts
- The tool automatically retries failed operations
- For very slow connections, consider uploading database separately
- Check network stability and bandwidth

## Security Considerations

- Passwords are hidden during input
- SSH keys are preferred over password authentication
- Database credentials are not logged or stored
- Backups are created before any destructive operations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Create an issue on GitHub
- Check existing issues for solutions
- Refer to troubleshooting section above

---

**Note**: Always test deployments on staging environments before deploying to production!