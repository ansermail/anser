cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.29"
  sha256 arm:   "1e89904fa0d9ee71a8ecb44615867d4aa9ebac4d2493365e1fdfdb5b0c0de9d1",
         intel: "dc6ed1074d1e2647300c36697691623b3dca2feae4ed8c1c3581a378df56bdce"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
