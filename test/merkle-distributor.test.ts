import { expect } from 'chai'
import { Contract, BigNumber, constants } from 'ethers'
import BalanceTree from './utils/merkle/balance-tree'
import { parseBalanceMap } from './utils/merkle/parse-balance-map'
import { deploy, getAccounts } from './utils/helpers'
import { ERC677, MerkleDistributor } from '../typechain-types'

// Copied and modified from: https://github.com/Uniswap/merkle-distributor/blob/master/test/MerkleDistributor.spec.ts
// to test contract changes

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

describe('MerkleDistributor', () => {
  let accounts: string[]
  let wallet0: string
  let wallet1: string

  before(async () => {
    // @ts-ignore
    ;({ signers, accounts } = await getAccounts())
  })

  let token: Contract
  beforeEach('deploy token', async () => {
    wallet0 = accounts[0]
    wallet1 = accounts[1]

    token = (await deploy('ERC677', ['Token', 'TKN', 0])) as ERC677
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
      await distributor.addDistribution(token.address, ZERO_BYTES32)
      await expect(distributor.claim(0, 0, wallet0, 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    it('fails for invalid index', async () => {
      const distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
      await distributor.addDistribution(token.address, ZERO_BYTES32)
      await expect(distributor.claim(0, 0, wallet0, 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    describe('two account tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: wallet0, amount: BigNumber.from(100) },
          { account: wallet1, amount: BigNumber.from(101) },
        ])
        distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
        await distributor.addDistribution(token.address, tree.getHexRoot())
        await token.setBalance(distributor.address, 201)
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await expect(distributor.claim(0, 0, wallet0, 100, proof0))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0, 100)
        const proof1 = tree.getProof(1, wallet1, BigNumber.from(101))
        await expect(distributor.claim(0, 1, wallet1, 101, proof1))
          .to.emit(distributor, 'Claimed')
          .withArgs(1, wallet1, 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await token.balanceOf(wallet0)).to.eq(0)
        await distributor.claim(0, 0, wallet0, 100, proof0)
        expect(await token.balanceOf(wallet0)).to.eq(100)
      })

      it('must have enough to transfer', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        await token.setBalance(distributor.address, 99)
        await expect(distributor.claim(0, 0, wallet0, 100, proof0)).to.be.revertedWith(
          'ERC20: transfer amount exceeds balance'
        )
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, wallet0, BigNumber.from(100))
        expect(await distributor.isClaimed(0)).to.eq(false)
        expect(await distributor.isClaimed(1)).to.eq(false)
        await distributor.claim(0, 0, wallet0, 100, proof0)
        expect(await distributor.isClaimed(0)).to.eq(true)
        expect(await distributor.isClaimed(1)).to.eq(false)
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

      it('gas', async () => {
        const proof = tree.getProof(0, wallet0, BigNumber.from(100))
        const tx = await distributor.claim(0, 0, wallet0, 100, proof)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(78466)
      })
    })
    describe('larger tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree(
          accounts.map((account: string, ix: number) => {
            return { account: account, amount: BigNumber.from(ix + 1) }
          })
        )
        distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
        await distributor.addDistribution(token.address, tree.getHexRoot())
        await token.setBalance(distributor.address, 201)
      })

      it('claim index 4', async () => {
        const proof = tree.getProof(4, accounts[4], BigNumber.from(5))
        await expect(distributor.claim(0, 4, accounts[4], 5, proof))
          .to.emit(distributor, 'Claimed')
          .withArgs(4, accounts[4], 5)
      })

      it('claim index 9', async () => {
        const proof = tree.getProof(9, accounts[9], BigNumber.from(10))
        await expect(distributor.claim(0, 9, accounts[9], 10, proof))
          .to.emit(distributor, 'Claimed')
          .withArgs(9, accounts[9], 10)
      })

      it('gas', async () => {
        const proof = tree.getProof(9, accounts[9], BigNumber.from(10))
        const tx = await distributor.claim(0, 9, accounts[9], 10, proof)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(80960)
      })

      it('gas second down about 15k', async () => {
        await distributor.claim(
          0,
          0,
          wallet0,
          1,
          tree.getProof(0, wallet0, BigNumber.from(1))
        )
        const tx = await distributor.claim(
          0,
          1,
          wallet1,
          2,
          tree.getProof(1, wallet1, BigNumber.from(2))
        )
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(65940)
      })
    })

    describe('realistic size tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      const NUM_LEAVES = 100_000
      const NUM_SAMPLES = 25
      const elements: { account: string; amount: BigNumber }[] = []
      for (let i = 0; i < NUM_LEAVES; i++) {
        const node = { account: wallet0, amount: BigNumber.from(100) }
        elements.push(node)
      }
      tree = new BalanceTree(elements)

      it('proof verification works', () => {
        const root = Buffer.from(tree.getHexRoot().slice(2), 'hex')
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree
            .getProof(i, wallet0, BigNumber.from(100))
            .map((el: string) => Buffer.from(el.slice(2), 'hex'))
          const validProof = BalanceTree.verifyProof(i, wallet0, BigNumber.from(100), proof, root)
          expect(validProof).to.be.true
        }
      })

      beforeEach('deploy', async () => {
        distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
        await distributor.addDistribution(token.address, tree.getHexRoot())
        await token.setBalance(distributor.address, constants.MaxUint256)
      })

      it('gas', async () => {
        const proof = tree.getProof(50000, wallet0, BigNumber.from(100))
        const tx = await distributor.claim(0, 50000, wallet0, 100, proof)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(91650)
      })
      it('gas deeper node', async () => {
        const proof = tree.getProof(90000, wallet0, BigNumber.from(100))
        const tx = await distributor.claim(0, 90000, wallet0, 100, proof)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(91586)
      })
      it('gas average random distribution', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree.getProof(i, wallet0, BigNumber.from(100))
          const tx = await distributor.claim(0, i, wallet0, 100, proof)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(77075)
      })
      // this is what we gas golfed by packing the bitmap
      it('gas average first 25', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < 25; i++) {
          const proof = tree.getProof(i, wallet0, BigNumber.from(100))
          const tx = await distributor.claim(0, i, wallet0, 100, proof)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(62824)
      })

      it('no double claims in random distribution', async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
          const proof = tree.getProof(i, wallet0, BigNumber.from(100))
          await distributor.claim(0, i, wallet0, 100, proof)
          await expect(distributor.claim(0, i, wallet0, 100, proof)).to.be.revertedWith(
            'MerkleDistributor: Drop already claimed.'
          )
        }
      })
    })
  })

  describe('parseBalanceMap', () => {
    let distributor: Contract
    let claims: {
      [account: string]: {
        index: number
        amount: string
        proof: string[]
      }
    }
    beforeEach('deploy', async () => {
      const {
        claims: innerClaims,
        merkleRoot,
        tokenTotal,
      } = parseBalanceMap({
        [wallet0]: 200,
        [wallet1]: 300,
        [accounts[2]]: 250,
      })
      expect(tokenTotal).to.eq('0x02ee') // 750
      claims = innerClaims
      distributor = (await deploy('MerkleDistributor')) as MerkleDistributor
      await distributor.addDistribution(token.address, merkleRoot)
      await token.setBalance(distributor.address, tokenTotal)
    })

    it('check the proofs is as expected', () => {
      expect(claims).to.deep.eq({
        [wallet0]: {
          index: 0,
          amount: '0xc8',
          proof: ['0x2a411ed78501edb696adca9e41e78d8256b61cfac45612fa0434d7cf87d916c6'],
        },
        [wallet1]: {
          index: 1,
          amount: '0x012c',
          proof: [
            '0xbfeb956a3b705056020a3b64c540bff700c0f6c96c55c0a5fcab57124cb36f7b',
            '0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa',
          ],
        },
        [accounts[2]]: {
          index: 2,
          amount: '0xfa',
          proof: [
            '0xceaacce7533111e902cc548e961d77b23a4d8cd073c6b68ccf55c62bd47fc36b',
            '0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa',
          ],
        },
      })
    })

    it('all claims work exactly once', async () => {
      for (let account in claims) {
        const claim = claims[account]
        await expect(distributor.claim(0, claim.index, account, claim.amount, claim.proof))
          .to.emit(distributor, 'Claimed')
          .withArgs(claim.index, account, claim.amount)
        await expect(
          distributor.claim(0, claim.index, account, claim.amount, claim.proof)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      }
      expect(await token.balanceOf(distributor.address)).to.eq(0)
    })
  })
})
