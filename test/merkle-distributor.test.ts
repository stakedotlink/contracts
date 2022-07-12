import { expect } from 'chai'
import { BigNumber, Signer } from 'ethers'
import BalanceTree from './utils/merkle/balance-tree'
import { deploy, getAccounts } from './utils/helpers'
import { ERC677, MerkleDistributor } from '../typechain-types'

// Copied and modified from: https://github.com/Uniswap/merkle-distributor/blob/master/test/MerkleDistributor.spec.ts
// to test contract changes.
// Most tests have been removed as core functionality has not changed, focus on testing multiple distributions

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

describe('MerkleDistributor', () => {
  let accounts: string[]
  let wallet0: string
  let wallet1: string
  // @ts-ignore
  let signers: Signer[]
  let token: ERC677

  before(async () => {
    ;({ signers, accounts } = await getAccounts())
  })

  beforeEach('deploy token', async () => {
    wallet0 = accounts[1]
    wallet1 = accounts[2]

    token = (await deploy('ERC677', ['Token', 'TKN', 1000000])) as ERC677
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
      await distributor.addDistribution(token.address, ZERO_BYTES32)
      await expect(distributor.claim(0, 0, wallet0, 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    describe('two account tree', () => {
      let distributor: MerkleDistributor
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: wallet0, amount: BigNumber.from(100) },
          { account: wallet1, amount: BigNumber.from(101) },
        ])
        distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
        await distributor.addDistribution(token.address, tree.getHexRoot())
        await token.transfer(distributor.address, BigNumber.from(201))
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(distributor.claim(0, 0, wallet0, 100, proof0))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, 0, wallet0, 100)
        const proof1 = tree.getProof(1, wallet1, BigNumber.from(101))
        await expect(distributor.claim(0, 1, wallet1, 101, proof1))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, 1, wallet1, 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await token.balanceOf(wallet0)).to.eq(0)
        await distributor.claim(0, 0, wallet0, 100, proof0)
        expect(await token.balanceOf(wallet0)).to.eq(100)
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await distributor.isClaimed(0, 0)).to.eq(false)
        expect(await distributor.isClaimed(0, 1)).to.eq(false)
        await distributor.claim(0, 0, wallet0, 100, proof0)
        expect(await distributor.isClaimed(0, 0)).to.eq(true)
        expect(await distributor.isClaimed(0, 1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await distributor.claim(0, 0, wallet0, 100, proof0)
        await expect(distributor.claim(0, 0, wallet0, 100, proof0)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await distributor.claim(0, 0, wallet0, 100, tree.getProof(0, wallet0, BigNumber.from(100)))
        await distributor.claim(0, 1, wallet1, 101, tree.getProof(1, wallet1, BigNumber.from(101)))

        await expect(
          distributor.claim(0, 0, wallet0, 100, tree.getProof(0, wallet0, BigNumber.from(100)))
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await distributor.claim(0, 1, wallet1, 101, tree.getProof(1, wallet1, BigNumber.from(101)))
        await distributor.claim(0, 0, wallet0, 100, tree.getProof(0, wallet0, BigNumber.from(100)))

        await expect(
          distributor.claim(0, 1, wallet1, 101, tree.getProof(1, wallet1, BigNumber.from(101)))
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim for address other than proof', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(distributor.claim(0, 1, wallet1, 101, proof0)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim more than proof', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(distributor.claim(0, 0, wallet0, 101, proof0)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim distribution that does not exist', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(distributor.claim(1, 0, wallet0, 101, proof0)).to.be.revertedWith(
          'MerkleDistributor: Distribution does not exist.'
        )
      })
    })

    describe('two distributions', () => {
      let distributor: MerkleDistributor
      let tree: BalanceTree
      let token2: ERC677
      beforeEach('deploy', async () => {
        token2 = (await deploy('ERC677', ['Token', 'TKN', 1000000])) as ERC677
        tree = new BalanceTree([
          { account: wallet0, amount: BigNumber.from(100) },
          { account: wallet1, amount: BigNumber.from(101) },
        ])
        distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
        await distributor.addDistributions(
          [token.address, token2.address, token2.address],
          [tree.getHexRoot(), tree.getHexRoot(), tree.getHexRoot()]
        )

        await token.transfer(distributor.address, BigNumber.from(201))
        await token2.transfer(distributor.address, BigNumber.from(201))
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(distributor.claim(0, 0, wallet0, 100, proof0))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, 0, wallet0, 100)
        await expect(distributor.claim(1, 0, wallet0, 100, proof0))
          .to.emit(distributor, 'Claimed')
          .withArgs(1, 0, wallet0, 100)
        const proof1 = tree.getProof(1, wallet1, BigNumber.from(101))
        await expect(distributor.claim(0, 1, wallet1, 101, proof1))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, 1, wallet1, 101)
        await expect(distributor.claim(1, 1, wallet1, 101, proof1))
          .to.emit(distributor, 'Claimed')
          .withArgs(1, 1, wallet1, 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await token.balanceOf(wallet0)).to.eq(0)
        await distributor.claim(0, 0, wallet0, 100, proof0)
        expect(await token.balanceOf(wallet0)).to.eq(100)
        await distributor.claim(1, 0, wallet0, 100, proof0)
        expect(await token2.balanceOf(wallet0)).to.eq(100)
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await distributor.isClaimed(0, 0)).to.eq(false)
        expect(await distributor.isClaimed(0, 1)).to.eq(false)
        await distributor.claim(0, 0, wallet0, 100, proof0)
        expect(await distributor.isClaimed(0, 0)).to.eq(true)
        expect(await distributor.isClaimed(0, 1)).to.eq(false)

        expect(await distributor.isClaimed(1, 0)).to.eq(false)
        expect(await distributor.isClaimed(1, 1)).to.eq(false)
        await distributor.claim(1, 0, wallet0, 100, proof0)
        expect(await distributor.isClaimed(1, 0)).to.eq(true)
        expect(await distributor.isClaimed(1, 1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await distributor.claim(0, 0, wallet0, 100, proof0)
        await expect(distributor.claim(0, 0, wallet0, 100, proof0)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )

        await distributor.claim(1, 0, wallet0, 100, proof0)
        await expect(distributor.claim(1, 0, wallet0, 100, proof0)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot add distributions of unequal length', async () => {
        await expect(
          distributor.addDistributions(
            [token.address, token2.address, token2.address],
            [tree.getHexRoot(), tree.getHexRoot()]
          )
        ).to.be.revertedWith('MerkleDistributor: Array lengths need to match.')
      })
    })
  })
})
