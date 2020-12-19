module.exports = {
  client: require('ganache-cli'),
  providerOptions: {
    mnemonic: "candy maple cake sugar pudding cream honey rich smooth crumble sweet treat"
  },
  silent: true,
  skipFiles: [
    'Migrations.sol',
    'mocks/',
    'packages/',
    'external/canonical-weth',
    'external/proxies/CERC20Proxy.sol',
    'external/proxies/CETHProxy.sol'
  ]
}