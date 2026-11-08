cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.40"
  sha256 arm:   "1ee2fa147425ce22024e90dced9ceb29fbb82219c626c8aaf8e5cb66a47d3d06",
         intel: "30f5cd9bdf4d3e25d0ab7eff5960e84058d94079ab90e645ce8c24f95368c9f9"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
