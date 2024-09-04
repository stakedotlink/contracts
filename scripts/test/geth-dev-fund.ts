import { ethers } from 'hardhat'
import { getAccounts } from '../utils/helpers'

async function main() {
  const { accounts } = await getAccounts()
  let customHttpProvider = new ethers.JsonRpcProvider(process.env.GETH_URL)
  let coinbase = await customHttpProvider.send('eth_coinbase', [])
  let coinbaseSigner = await customHttpProvider.getSigner(coinbase)

  for (let i = 0; i < accounts.length; i++) {
    let signer = await ethers.provider.getSigner(i)
    let address = signer.getAddress()
    let balance = await ethers.provider.getBalance(address)

    if (balance > 0n) {
      console.log(`Account ${await signer.getAddress()} already has a balance skipping`)
      continue
    }

    let txObj = {
      to: signer.getAddress(),
      value: ethers.parseEther('50'),
    }
    let tx = await coinbaseSigner.sendTransaction(txObj)
    await tx.wait()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
